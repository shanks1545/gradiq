import sqlite3
import os
import json
import base64
import re
from io import BytesIO
from datetime import datetime, timedelta, timezone
from contextlib import contextmanager

from dotenv import load_dotenv
load_dotenv()

import anthropic
from fastapi import FastAPI, HTTPException, Depends, status, File, UploadFile, Form
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel
from jose import JWTError, jwt
from passlib.context import CryptContext

SECRET_KEY = os.environ.get("GRADIQ_SECRET_KEY", "dev-secret-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24
DB_PATH = os.environ.get("DB_PATH", "gradiq.db")
PORT = int(os.environ.get("PORT", 8000))

if not os.environ.get("ANTHROPIC_API_KEY"):
    print("\n⚠  WARNING: ANTHROPIC_API_KEY is not set. Student grading will not work.")
    print("   Export it before starting:  export ANTHROPIC_API_KEY='sk-ant-...'\n")

claude_client = anthropic.Anthropic()

app = FastAPI(title="GradiQ")

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/login")


# ── Database ─────────────────────────────────────────────────────────

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def db_session():
    conn = get_db()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    with db_session() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS teachers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS tests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                teacher_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                subject TEXT NOT NULL,
                total_marks INTEGER NOT NULL,
                num_questions INTEGER NOT NULL,
                created_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (teacher_id) REFERENCES teachers(id)
            );
            CREATE TABLE IF NOT EXISTS answer_keys (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                test_id INTEGER NOT NULL,
                question_number INTEGER NOT NULL,
                correct_answer TEXT NOT NULL,
                UNIQUE(test_id, question_number),
                FOREIGN KEY (test_id) REFERENCES tests(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS student_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                test_id INTEGER NOT NULL,
                student_name TEXT NOT NULL,
                answers_json TEXT NOT NULL,
                score INTEGER NOT NULL,
                total_marks INTEGER NOT NULL,
                percentage REAL NOT NULL,
                grade TEXT NOT NULL,
                graded_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (test_id) REFERENCES tests(id) ON DELETE CASCADE
            );
        """)
        try:
            conn.execute("ALTER TABLE student_results ADD COLUMN child_code TEXT")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE tests ADD COLUMN question_types TEXT")
        except sqlite3.OperationalError:
            pass
        for col in ("institute_name", "city", "board", "student_count"):
            try:
                conn.execute(f"ALTER TABLE teachers ADD COLUMN {col} TEXT")
            except sqlite3.OperationalError:
                pass
        row = conn.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='answer_keys'").fetchone()
        if row and "CHECK" in row["sql"]:
            conn.executescript("""
                CREATE TABLE answer_keys_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    test_id INTEGER NOT NULL,
                    question_number INTEGER NOT NULL,
                    correct_answer TEXT NOT NULL,
                    UNIQUE(test_id, question_number),
                    FOREIGN KEY (test_id) REFERENCES tests(id) ON DELETE CASCADE
                );
                INSERT INTO answer_keys_new SELECT * FROM answer_keys;
                DROP TABLE answer_keys;
                ALTER TABLE answer_keys_new RENAME TO answer_keys;
            """)


init_db()


# ── Schemas ──────────────────────────────────────────────────────────

class TeacherCreate(BaseModel):
    name: str
    email: str
    password: str


class TestCreate(BaseModel):
    name: str
    subject: str
    total_marks: int
    num_questions: int


class ScoreUpdate(BaseModel):
    score: float


class ProfileUpdate(BaseModel):
    institute_name: str | None = None
    city: str | None = None
    board: str | None = None
    student_count: str | None = None


class AnswerKeyEntry(BaseModel):
    question_number: int
    correct_answer: str


class AnswerKeySubmit(BaseModel):
    answers: list[AnswerKeyEntry]
    question_types: list[str] | None = None


# ── Auth helpers ─────────────────────────────────────────────────────

def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def get_current_teacher(token: str = Depends(oauth2_scheme)) -> dict:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        teacher_id_str = payload.get("sub")
        if teacher_id_str is None:
            raise credentials_exception
        teacher_id = int(teacher_id_str)
    except (JWTError, ValueError):
        raise credentials_exception

    with db_session() as conn:
        row = conn.execute("SELECT id, name, email, institute_name FROM teachers WHERE id = ?", (teacher_id,)).fetchone()
    if row is None:
        raise credentials_exception
    return dict(row)


# ── Auth routes ──────────────────────────────────────────────────────

@app.post("/api/register")
def register(teacher: TeacherCreate):
    with db_session() as conn:
        existing = conn.execute("SELECT id FROM teachers WHERE email = ?", (teacher.email,)).fetchone()
        if existing:
            raise HTTPException(status_code=400, detail="Email already registered")
        hashed = pwd_context.hash(teacher.password)
        conn.execute(
            "INSERT INTO teachers (name, email, password_hash) VALUES (?, ?, ?)",
            (teacher.name, teacher.email, hashed),
        )
    return {"message": "Account created successfully"}


@app.post("/api/login")
def login(form_data: OAuth2PasswordRequestForm = Depends()):
    with db_session() as conn:
        row = conn.execute("SELECT * FROM teachers WHERE email = ?", (form_data.username,)).fetchone()
    if not row or not pwd_context.verify(form_data.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token({"sub": str(row["id"])})
    return {"access_token": token, "token_type": "bearer", "teacher_name": row["name"], "institute_name": row["institute_name"] or ""}


@app.patch("/api/profile")
def update_profile(body: ProfileUpdate, teacher: dict = Depends(get_current_teacher)):
    with db_session() as conn:
        conn.execute(
            "UPDATE teachers SET institute_name = ?, city = ?, board = ?, student_count = ? WHERE id = ?",
            (body.institute_name, body.city, body.board, body.student_count, teacher["id"]),
        )
    return {"message": "Profile updated", "institute_name": body.institute_name or ""}


@app.get("/api/profile")
def get_profile(teacher: dict = Depends(get_current_teacher)):
    with db_session() as conn:
        row = conn.execute(
            "SELECT institute_name, city, board, student_count FROM teachers WHERE id = ?",
            (teacher["id"],),
        ).fetchone()
    return dict(row) if row else {}


# ── Test routes ──────────────────────────────────────────────────────

@app.get("/api/tests")
def list_tests(teacher: dict = Depends(get_current_teacher)):
    with db_session() as conn:
        rows = conn.execute(
            "SELECT id, name, subject, total_marks, num_questions, created_at FROM tests WHERE teacher_id = ? ORDER BY created_at DESC",
            (teacher["id"],),
        ).fetchall()
    return [dict(r) for r in rows]


@app.post("/api/tests")
def create_test(test: TestCreate, teacher: dict = Depends(get_current_teacher)):
    if test.num_questions < 1 or test.total_marks < 1:
        raise HTTPException(status_code=400, detail="Questions and marks must be at least 1")
    with db_session() as conn:
        cursor = conn.execute(
            "INSERT INTO tests (teacher_id, name, subject, total_marks, num_questions) VALUES (?, ?, ?, ?, ?)",
            (teacher["id"], test.name, test.subject, test.total_marks, test.num_questions),
        )
        test_id = cursor.lastrowid
    return {"id": test_id, "message": "Test created"}


@app.get("/api/tests/{test_id}")
def get_test(test_id: int, teacher: dict = Depends(get_current_teacher)):
    with db_session() as conn:
        test = conn.execute(
            "SELECT * FROM tests WHERE id = ? AND teacher_id = ?", (test_id, teacher["id"])
        ).fetchone()
        if not test:
            raise HTTPException(status_code=404, detail="Test not found")
        answers = conn.execute(
            "SELECT question_number, correct_answer FROM answer_keys WHERE test_id = ? ORDER BY question_number",
            (test_id,),
        ).fetchall()
    return {**dict(test), "answer_key": [dict(a) for a in answers]}


@app.delete("/api/tests/{test_id}")
def delete_test(test_id: int, teacher: dict = Depends(get_current_teacher)):
    with db_session() as conn:
        row = conn.execute("SELECT id FROM tests WHERE id = ? AND teacher_id = ?", (test_id, teacher["id"])).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Test not found")
        conn.execute("DELETE FROM tests WHERE id = ?", (test_id,))
    return {"message": "Test deleted"}


# ── Answer key routes ────────────────────────────────────────────────

@app.post("/api/tests/{test_id}/answer-key")
def save_answer_key(test_id: int, body: AnswerKeySubmit, teacher: dict = Depends(get_current_teacher)):
    with db_session() as conn:
        test = conn.execute(
            "SELECT * FROM tests WHERE id = ? AND teacher_id = ?", (test_id, teacher["id"])
        ).fetchone()
        if not test:
            raise HTTPException(status_code=404, detail="Test not found")
        if len(body.answers) != test["num_questions"]:
            raise HTTPException(
                status_code=400,
                detail=f"Expected {test['num_questions']} answers, got {len(body.answers)}",
            )
        qtypes = body.question_types or ["mcq"] * test["num_questions"]
        if len(qtypes) != test["num_questions"]:
            raise HTTPException(status_code=400, detail="Question types count must match number of questions")
        for i, a in enumerate(body.answers):
            qt = qtypes[i]
            if qt == "mcq" and a.correct_answer not in ("A", "B", "C", "D"):
                raise HTTPException(status_code=400, detail=f"Invalid MCQ answer for Q{a.question_number}")
            elif qt == "tf" and a.correct_answer not in ("True", "False"):
                raise HTTPException(status_code=400, detail=f"Invalid True/False answer for Q{a.question_number}")
            elif qt == "fill" and not a.correct_answer.strip():
                raise HTTPException(status_code=400, detail=f"Fill-in answer cannot be empty for Q{a.question_number}")

        conn.execute("UPDATE tests SET question_types = ? WHERE id = ?", (json.dumps(qtypes), test_id))
        conn.execute("DELETE FROM answer_keys WHERE test_id = ?", (test_id,))
        conn.executemany(
            "INSERT INTO answer_keys (test_id, question_number, correct_answer) VALUES (?, ?, ?)",
            [(test_id, a.question_number, a.correct_answer) for a in body.answers],
        )
    return {"message": "Answer key saved"}


# ── Grading routes ──────────────────────────────────────────────────

def compute_grade(percentage: float) -> str:
    if percentage >= 90:
        return "A+"
    elif percentage >= 80:
        return "A"
    elif percentage >= 70:
        return "B"
    elif percentage >= 60:
        return "C"
    elif percentage >= 50:
        return "D"
    return "F"


def _normalize_tf(answer):
    a = answer.strip().lower()
    if a in ("true", "t", "yes", "y"):
        return "true"
    if a in ("false", "f", "no", "n"):
        return "false"
    return a


def _check_answer(student_ans, correct_ans, qtype):
    if student_ans == "?":
        return False
    if qtype == "fill":
        return correct_ans.strip().lower() in student_ans.strip().lower()
    if qtype == "tf":
        return _normalize_tf(student_ans) == _normalize_tf(correct_ans)
    return student_ans == correct_ans


def _build_student_map(student_answers, question_types):
    student_map = {}
    confidence_map = {}
    for a in student_answers:
        qn = a.get("question_number")
        sa = str(a.get("selected_answer", "")).strip()
        conf = a.get("confidence", "high")
        if qn is None or not sa:
            continue
        qi = int(qn)
        qt = question_types[qi - 1] if qi <= len(question_types) else "mcq"
        if qt == "mcq":
            sa = sa.upper()
            if sa in ("A", "B", "C", "D"):
                student_map[qi] = sa
                confidence_map[qi] = conf
        else:
            student_map[qi] = sa
            confidence_map[qi] = conf
    return student_map, confidence_map


def _derive_confidence(student_ans, correct_ans, qtype, ai_confidence):
    """Downgrade AI confidence based on answer characteristics."""
    if student_ans == "?":
        return "low"

    if qtype == "mcq":
        if student_ans not in ("A", "B", "C", "D"):
            return "low"
    elif qtype == "tf":
        norm = _normalize_tf(student_ans)
        if norm not in ("true", "false"):
            return "low"
        if student_ans.strip().lower() not in ("true", "false"):
            if ai_confidence == "high":
                return "medium"
    elif qtype == "fill":
        stripped = student_ans.strip()
        if len(stripped) <= 1:
            return "low"
        if not stripped.replace(" ", "").isalnum():
            if ai_confidence == "high":
                return "medium"

    return ai_confidence


def _score_answers(student_answers, answer_key_rows, test, question_types=None):
    if question_types is None:
        question_types = ["mcq"] * test["num_questions"]
    answer_key = {r["question_number"]: r["correct_answer"] for r in answer_key_rows}
    student_map, confidence_map = _build_student_map(student_answers, question_types)

    marks_per_question = test["total_marks"] / test["num_questions"]
    correct_count = 0
    comparison = []
    for q in range(1, test["num_questions"] + 1):
        student_ans = student_map.get(q, "?")
        correct_ans = answer_key.get(q, "?")
        qt = question_types[q - 1] if q <= len(question_types) else "mcq"
        is_correct = _check_answer(student_ans, correct_ans, qt)
        if is_correct:
            correct_count += 1
        ai_conf = confidence_map.get(q, "high")
        conf = _derive_confidence(student_ans, correct_ans, qt, ai_conf)
        comparison.append({
            "question_number": q,
            "student_answer": student_ans,
            "correct_answer": correct_ans,
            "is_correct": is_correct,
            "question_type": qt,
            "confidence": conf,
        })

    score = round(correct_count * marks_per_question, 2)
    if score == int(score):
        score = int(score)
    percentage = round((correct_count / test["num_questions"]) * 100, 1)
    grade = compute_grade(percentage)

    return comparison, score, percentage, grade, correct_count


def _generate_child_code(conn):
    row = conn.execute(
        "SELECT MAX(CAST(SUBSTR(child_code, 4) AS INTEGER)) as max_num "
        "FROM student_results WHERE child_code LIKE 'GRD%'"
    ).fetchone()
    num = (row["max_num"] or 0) + 1 if row else 1
    return f"GRD{num:03d}"


def extract_answers_with_claude(image_bytes: bytes, media_type: str, num_questions: int, question_types: list[str] | None = None) -> list[dict]:
    image_b64 = base64.b64encode(image_bytes).decode("utf-8")
    qtypes = question_types or ["mcq"] * num_questions

    has_mixed = len(set(qtypes)) > 1 or qtypes[0] != "mcq"

    conf_instruction = (
        'Also include "confidence" ("high", "medium", or "low") for each answer. '
        "Be critical and realistic — do NOT default to high for everything. "
        '"high" = the mark or writing is completely unambiguous, clearly one option with no doubt. '
        '"medium" = you can read it but there is some uncertainty — messy handwriting, '
        "a partially erased answer, a letter that could be read two ways, light or faint marks, "
        "multiple marks where one was crossed out, or a bubble not fully filled. "
        '"low" = the answer is very difficult to read, could plausibly be multiple different answers, '
        "the area appears blank or smudged, or you are mostly guessing. "
        "Most real student handwriting should have a mix of confidence levels. "
        "If in doubt between high and medium, choose medium."
    )

    if not has_mixed:
        prompt = (
            f"This is a photo of a student's MCQ answer sheet with {num_questions} questions. "
            f"Each question has options A, B, C, or D. The student has marked one option per question "
            f"(by circling, shading, ticking, or otherwise indicating their choice).\n\n"
            f"Extract the student's selected answer for each question from Q1 to Q{num_questions}.\n\n"
            f"Return ONLY a JSON array with exactly {num_questions} objects, each with "
            f'"question_number" (integer), "selected_answer" (one of "A", "B", "C", "D"), '
            f"and {conf_instruction}\n"
            f"If a question appears unanswered or unclear, use your best judgment. "
            f"Return ONLY the JSON array, no other text."
        )
    else:
        type_lines = []
        for i, qt in enumerate(qtypes, 1):
            if qt == "mcq":
                type_lines.append(f"Q{i}: MCQ (A/B/C/D)")
            elif qt == "fill":
                type_lines.append(f"Q{i}: Fill in the Blank")
            elif qt == "tf":
                type_lines.append(f"Q{i}: True/False")
        type_list = "\n".join(type_lines)

        prompt = (
            f"This is a photo of a student's answer sheet with {num_questions} questions.\n\n"
            f"The questions have the following types:\n{type_list}\n\n"
            f"For MCQ questions: extract the circled, shaded, ticked, or otherwise indicated letter (A, B, C, or D).\n"
            f"For Fill in the Blank questions: extract exactly what the student wrote in the blank space.\n"
            f"For True/False questions: determine if the student indicated True or False "
            f"(may be written as True/False, T/F, Yes/No, or by ticking/circling one option).\n\n"
            f"Return ONLY a JSON array with exactly {num_questions} objects, each with "
            f'"question_number" (integer), "selected_answer" '
            f'(for MCQ: one of "A","B","C","D"; for Fill in the Blank: the text written; '
            f'for True/False: "True" or "False"), '
            f"and {conf_instruction}\n"
            f"If a question appears unanswered or unclear, use your best judgment. "
            f"Return ONLY the JSON array, no other text."
        )

    response = claude_client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=2048,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": image_b64,
                        },
                    },
                    {"type": "text", "text": prompt},
                ],
            }
        ],
    )

    raw = response.content[0].text.strip()
    match = re.search(r"\[.*\]", raw, re.DOTALL)
    if not match:
        raise ValueError(f"Claude did not return valid JSON: {raw[:200]}")
    return json.loads(match.group())


ALLOWED_IMAGE_TYPES = {
    "image/jpeg": "image/jpeg",
    "image/png": "image/png",
    "image/webp": "image/webp",
    "image/gif": "image/gif",
}


@app.post("/api/tests/{test_id}/grade")
async def grade_student(
    test_id: int,
    student_name: str = Form(...),
    answer_sheet: UploadFile = File(...),
    teacher: dict = Depends(get_current_teacher),
):
    with db_session() as conn:
        test = conn.execute(
            "SELECT * FROM tests WHERE id = ? AND teacher_id = ?", (test_id, teacher["id"])
        ).fetchone()
        if not test:
            raise HTTPException(status_code=404, detail="Test not found")

        answer_key_rows = conn.execute(
            "SELECT question_number, correct_answer FROM answer_keys WHERE test_id = ? ORDER BY question_number",
            (test_id,),
        ).fetchall()
        if len(answer_key_rows) != test["num_questions"]:
            raise HTTPException(status_code=400, detail="Answer key is incomplete. Please set the full answer key first.")

    media_type = ALLOWED_IMAGE_TYPES.get(answer_sheet.content_type)
    if not media_type:
        raise HTTPException(status_code=400, detail="Upload a JPEG, PNG, WebP, or GIF image.")

    image_bytes = await answer_sheet.read()
    if len(image_bytes) > 20 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image must be under 20 MB.")

    question_types = json.loads(test["question_types"]) if test["question_types"] else ["mcq"] * test["num_questions"]

    try:
        student_answers = extract_answers_with_claude(image_bytes, media_type, test["num_questions"], question_types)
    except anthropic.APIError as e:
        raise HTTPException(status_code=502, detail=f"Claude API error: {e.message}")
    except (ValueError, json.JSONDecodeError) as e:
        raise HTTPException(status_code=502, detail=f"Could not parse Claude response: {str(e)}")

    answer_key = {r["question_number"]: r["correct_answer"] for r in answer_key_rows}
    student_map, confidence_map = _build_student_map(student_answers, question_types)

    print(f"\n{'='*60}")
    print(f"GRADING DEBUG — Student: {student_name}, Test: {test['name']} (id={test_id})")
    print(f"{'='*60}")
    print(f"Answer key from DB ({len(answer_key)} questions):")
    for q in sorted(answer_key):
        print(f"  Q{q}: {answer_key[q]}")
    print(f"\nClaude extracted answers ({len(student_map)} questions):")
    for q in sorted(student_map):
        print(f"  Q{q}: {student_map[q]} (conf={confidence_map.get(q, 'high')})")
    if len(answer_key) != len(student_map):
        print(f"\n⚠  MISMATCH: answer key has {len(answer_key)} questions, Claude extracted {len(student_map)}")
    print(f"\nQuestion-by-question comparison:")

    marks_per_question = test["total_marks"] / test["num_questions"]
    correct_count = 0
    comparison = []
    for q in range(1, test["num_questions"] + 1):
        student_ans = student_map.get(q, "?")
        correct_ans = answer_key.get(q, "?")
        qt = question_types[q - 1] if q <= len(question_types) else "mcq"
        ai_conf = confidence_map.get(q, "high")
        conf = _derive_confidence(student_ans, correct_ans, qt, ai_conf)
        is_correct = _check_answer(student_ans, correct_ans, qt)
        if is_correct:
            correct_count += 1
        status = "✓" if is_correct else "✗"
        print(f"  Q{q} [{qt}]: student={student_ans} key={correct_ans} {status} (ai_conf={ai_conf} -> {conf})")
        comparison.append({
            "question_number": q,
            "student_answer": student_ans,
            "correct_answer": correct_ans,
            "is_correct": is_correct,
            "question_type": qt,
            "confidence": conf,
        })

    score = round(correct_count * marks_per_question, 2)
    if score == int(score):
        score = int(score)
    percentage = round((correct_count / test["num_questions"]) * 100, 1)
    grade = compute_grade(percentage)

    print(f"\nResult: {correct_count}/{test['num_questions']} correct, score={score}/{test['total_marks']}, {percentage}%, grade={grade}")
    print(f"{'='*60}\n")

    with db_session() as conn:
        cursor = conn.execute(
            "INSERT INTO student_results (test_id, student_name, answers_json, score, total_marks, percentage, grade) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (test_id, student_name, json.dumps(comparison), score, test["total_marks"], percentage, grade),
        )
        result_id = cursor.lastrowid

    return {
        "result_id": result_id,
        "student_name": student_name,
        "score": score,
        "total_marks": test["total_marks"],
        "percentage": percentage,
        "grade": grade,
        "correct_count": correct_count,
        "num_questions": test["num_questions"],
        "comparison": comparison,
    }


@app.post("/api/tests/{test_id}/grade-batch-item")
async def grade_batch_item(
    test_id: int,
    student_name: str = Form(...),
    answer_sheet: UploadFile = File(...),
    teacher: dict = Depends(get_current_teacher),
):
    with db_session() as conn:
        test = conn.execute(
            "SELECT * FROM tests WHERE id = ? AND teacher_id = ?", (test_id, teacher["id"])
        ).fetchone()
        if not test:
            raise HTTPException(status_code=404, detail="Test not found")
        answer_key_rows = conn.execute(
            "SELECT question_number, correct_answer FROM answer_keys WHERE test_id = ? ORDER BY question_number",
            (test_id,),
        ).fetchall()
        if len(answer_key_rows) != test["num_questions"]:
            raise HTTPException(status_code=400, detail="Answer key is incomplete.")

    media_type = ALLOWED_IMAGE_TYPES.get(answer_sheet.content_type)
    if not media_type:
        raise HTTPException(status_code=400, detail="Upload a JPEG, PNG, WebP, or GIF image.")
    image_bytes = await answer_sheet.read()
    if len(image_bytes) > 20 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image must be under 20 MB.")

    question_types = json.loads(test["question_types"]) if test["question_types"] else ["mcq"] * test["num_questions"]

    try:
        student_answers = extract_answers_with_claude(image_bytes, media_type, test["num_questions"], question_types)
    except anthropic.APIError as e:
        raise HTTPException(status_code=502, detail=f"Claude API error: {e.message}")
    except (ValueError, json.JSONDecodeError) as e:
        raise HTTPException(status_code=502, detail=f"Could not parse Claude response: {str(e)}")

    comparison, score, percentage, grade, correct_count = _score_answers(
        student_answers, answer_key_rows, test, question_types
    )

    with db_session() as conn:
        existing = conn.execute(
            "SELECT id, child_code FROM student_results WHERE test_id = ? AND student_name = ?",
            (test_id, student_name),
        ).fetchone()

        if existing:
            conn.execute(
                "UPDATE student_results SET answers_json = ?, score = ?, total_marks = ?, percentage = ?, grade = ?, graded_at = datetime('now') "
                "WHERE id = ?",
                (json.dumps(comparison), score, test["total_marks"], percentage, grade, existing["id"]),
            )
            result_id = existing["id"]
            child_code = existing["child_code"] or _generate_child_code(conn)
            if not existing["child_code"]:
                conn.execute("UPDATE student_results SET child_code = ? WHERE id = ?", (child_code, result_id))
        else:
            child_code = _generate_child_code(conn)
            cursor = conn.execute(
                "INSERT INTO student_results (test_id, student_name, answers_json, score, total_marks, percentage, grade, child_code) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (test_id, student_name, json.dumps(comparison), score, test["total_marks"], percentage, grade, child_code),
            )
            result_id = cursor.lastrowid

    return {
        "result_id": result_id,
        "student_name": student_name,
        "score": score,
        "total_marks": test["total_marks"],
        "percentage": percentage,
        "grade": grade,
        "correct_count": correct_count,
        "num_questions": test["num_questions"],
        "comparison": comparison,
        "child_code": child_code,
    }


@app.delete("/api/tests/{test_id}/results")
def clear_results(test_id: int, teacher: dict = Depends(get_current_teacher)):
    with db_session() as conn:
        test = conn.execute(
            "SELECT id FROM tests WHERE id = ? AND teacher_id = ?", (test_id, teacher["id"])
        ).fetchone()
        if not test:
            raise HTTPException(status_code=404, detail="Test not found")
        conn.execute("DELETE FROM student_results WHERE test_id = ?", (test_id,))
    return {"message": "All results cleared"}


@app.get("/api/tests/{test_id}/results")
def get_results(test_id: int, teacher: dict = Depends(get_current_teacher)):
    with db_session() as conn:
        test = conn.execute(
            "SELECT id FROM tests WHERE id = ? AND teacher_id = ?", (test_id, teacher["id"])
        ).fetchone()
        if not test:
            raise HTTPException(status_code=404, detail="Test not found")
        rows = conn.execute(
            "SELECT id, student_name, score, total_marks, percentage, grade, answers_json, graded_at, child_code "
            "FROM student_results WHERE test_id = ? ORDER BY graded_at DESC",
            (test_id,),
        ).fetchall()
    results = []
    for r in rows:
        d = dict(r)
        d["comparison"] = json.loads(d.pop("answers_json"))
        results.append(d)
    return results


@app.patch("/api/results/{result_id}/score")
def update_score(result_id: int, body: ScoreUpdate, teacher: dict = Depends(get_current_teacher)):
    with db_session() as conn:
        row = conn.execute(
            "SELECT sr.id, sr.total_marks FROM student_results sr "
            "JOIN tests t ON sr.test_id = t.id "
            "WHERE sr.id = ? AND t.teacher_id = ?",
            (result_id, teacher["id"]),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Result not found")
        total_marks = row["total_marks"]
        if body.score < 0 or body.score > total_marks:
            raise HTTPException(status_code=400, detail=f"Score must be between 0 and {total_marks}")
        score = round(body.score, 2)
        if score == int(score):
            score = int(score)
        percentage = round((score / total_marks) * 100, 1)
        grade = compute_grade(percentage)
        conn.execute(
            "UPDATE student_results SET score = ?, percentage = ?, grade = ? WHERE id = ?",
            (score, percentage, grade, result_id),
        )
    return {"score": score, "percentage": percentage, "grade": grade}


@app.delete("/api/results/{result_id}")
def delete_result(result_id: int, teacher: dict = Depends(get_current_teacher)):
    with db_session() as conn:
        row = conn.execute(
            "SELECT sr.id FROM student_results sr JOIN tests t ON sr.test_id = t.id WHERE sr.id = ? AND t.teacher_id = ?",
            (result_id, teacher["id"]),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Result not found")
        conn.execute("DELETE FROM student_results WHERE id = ?", (result_id,))
    return {"message": "Result deleted"}


# ── PDF report ──────────────────────────────────────────────────────

@app.get("/api/results/{result_id}/pdf")
def download_pdf(result_id: int, teacher: dict = Depends(get_current_teacher)):
    with db_session() as conn:
        row = conn.execute(
            "SELECT sr.*, t.name AS test_name, t.subject, t.num_questions "
            "FROM student_results sr "
            "JOIN tests t ON sr.test_id = t.id "
            "WHERE sr.id = ? AND t.teacher_id = ?",
            (result_id, teacher["id"]),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Result not found")

    result = dict(row)
    comparison = json.loads(result["answers_json"])

    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib.colors import HexColor
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
    from reportlab.lib.styles import ParagraphStyle

    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, topMargin=20*mm, bottomMargin=20*mm,
                            leftMargin=20*mm, rightMargin=20*mm)

    teal = HexColor("#14b8a6")
    dark = HexColor("#1a1a1a")
    gray = HexColor("#666666")
    light_gray = HexColor("#f0f0f0")
    green_bg = HexColor("#e6faf7")
    red_bg = HexColor("#fde8e8")
    white = HexColor("#ffffff")

    title_style = ParagraphStyle("Title", fontName="Helvetica-Bold", fontSize=22,
                                  textColor=teal, alignment=1, spaceAfter=2*mm)
    subtitle_style = ParagraphStyle("Subtitle", fontName="Helvetica", fontSize=10,
                                     textColor=gray, alignment=1, spaceAfter=8*mm)
    heading_style = ParagraphStyle("Heading", fontName="Helvetica-Bold", fontSize=13,
                                    textColor=dark, spaceBefore=6*mm, spaceAfter=4*mm)

    elements = []

    elements.append(Paragraph("GradiQ Demo", title_style))
    elements.append(Paragraph("Student Performance Report", subtitle_style))

    graded_date = result.get("graded_at", "")
    if graded_date:
        try:
            dt = datetime.strptime(graded_date, "%Y-%m-%d %H:%M:%S")
            graded_date = dt.strftime("%B %d, %Y")
        except ValueError:
            pass

    info_data = [
        ["Student Name", result["student_name"], "Test Name", result["test_name"]],
        ["Subject", result["subject"], "Date", graded_date],
    ]
    info_table = Table(info_data, colWidths=[30*mm, 55*mm, 30*mm, 55*mm])
    info_table.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTNAME", (2, 0), (2, -1), "Helvetica-Bold"),
        ("TEXTCOLOR", (0, 0), (0, -1), gray),
        ("TEXTCOLOR", (2, 0), (2, -1), gray),
        ("TEXTCOLOR", (1, 0), (1, -1), dark),
        ("TEXTCOLOR", (3, 0), (3, -1), dark),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 0), (-1, -1), 0.5, HexColor("#e0e0e0")),
    ]))
    elements.append(info_table)

    elements.append(Spacer(1, 4*mm))

    score_data = [
        ["Score", "Percentage", "Grade"],
        [f"{result['score']} / {result['total_marks']}", f"{result['percentage']}%", result["grade"]],
    ]
    score_table = Table(score_data, colWidths=[56.67*mm, 56.67*mm, 56.67*mm])

    score_table.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 9),
        ("TEXTCOLOR", (0, 0), (-1, 0), gray),
        ("FONTNAME", (0, 1), (-1, 1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 1), (-1, 1), 16),
        ("TEXTCOLOR", (0, 1), (-1, 1), dark),
        ("TEXTCOLOR", (2, 1), (2, 1), teal),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("BACKGROUND", (0, 0), (-1, -1), light_gray),
        ("ROUNDEDCORNERS", [3, 3, 3, 3]),
        ("TOPPADDING", (0, 0), (-1, 0), 8),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 4),
        ("TOPPADDING", (0, 1), (-1, 1), 4),
        ("BOTTOMPADDING", (0, 1), (-1, 1), 10),
    ]))
    elements.append(score_table)

    elements.append(Paragraph("Answer Breakdown", heading_style))

    ans_header = ["Q#", "Student Answer", "Correct Answer", "Result"]
    ans_rows = [ans_header]
    row_colors = []
    for c in comparison:
        status = "Correct" if c["is_correct"] else "Wrong"
        ans_rows.append([
            str(c["question_number"]),
            c["student_answer"],
            c["correct_answer"],
            status,
        ])
        row_colors.append(green_bg if c["is_correct"] else red_bg)

    ans_table = Table(ans_rows, colWidths=[20*mm, 45*mm, 45*mm, 60*mm])
    ans_style = [
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 9),
        ("TEXTCOLOR", (0, 0), (-1, 0), white),
        ("BACKGROUND", (0, 0), (-1, 0), teal),
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 1), (-1, -1), 10),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LINEBELOW", (0, 0), (-1, -1), 0.5, HexColor("#e0e0e0")),
        ("GRID", (0, 0), (-1, 0), 0, teal),
    ]
    for i, bg in enumerate(row_colors):
        ans_style.append(("BACKGROUND", (0, i + 1), (-1, i + 1), bg))
        if not comparison[i]["is_correct"]:
            ans_style.append(("TEXTCOLOR", (3, i + 1), (3, i + 1), HexColor("#dc2626")))
        else:
            ans_style.append(("TEXTCOLOR", (3, i + 1), (3, i + 1), HexColor("#0d9488")))

    ans_table.setStyle(TableStyle(ans_style))
    elements.append(ans_table)

    elements.append(Spacer(1, 10*mm))
    footer_style = ParagraphStyle("Footer", fontName="Helvetica-Oblique", fontSize=8,
                                   textColor=gray, alignment=1)
    elements.append(Paragraph("Generated by GradiQ — Smart Test Management for Educators", footer_style))

    doc.build(elements)
    buf.seek(0)

    filename = f"{result['student_name']}_{result['test_name']}_report.pdf".replace(" ", "_")
    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Static files ─────────────────────────────────────────────────────

app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
def serve_index():
    return FileResponse("static/index.html")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
