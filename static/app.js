const API = '';
let token = localStorage.getItem('gradiq_token');
let teacherName = localStorage.getItem('gradiq_name');
let currentTestId = null;
let currentResults = {};

// ── API helper ────────────────────────────────────────────────

async function api(path, options = {}) {
    const headers = options.headers || {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (options.body && !(options.body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(options.body);
    }
    const res = await fetch(`${API}${path}`, { ...options, headers });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Something went wrong');
    return data;
}

// ── Toast ─────────────────────────────────────────────────────

function toast(msg, isError = false) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast show' + (isError ? ' error' : '');
    setTimeout(() => el.className = 'toast', 3000);
}

// ── Auth ──────────────────────────────────────────────────────

document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(`${tab.dataset.tab}-form`).classList.add('active');
        document.getElementById('auth-error').textContent = '';
    });
});

document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('auth-error');
    errEl.textContent = '';
    try {
        const form = new URLSearchParams();
        form.append('username', document.getElementById('login-email').value);
        form.append('password', document.getElementById('login-password').value);
        const data = await fetch('/api/login', { method: 'POST', body: form });
        const json = await data.json();
        if (!data.ok) throw new Error(json.detail);
        token = json.access_token;
        teacherName = json.teacher_name;
        localStorage.setItem('gradiq_token', token);
        localStorage.setItem('gradiq_name', teacherName);
        enterDashboard();
    } catch (err) {
        errEl.textContent = err.message;
    }
});

document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('auth-error');
    errEl.textContent = '';
    try {
        await api('/api/register', {
            method: 'POST',
            body: {
                name: document.getElementById('reg-name').value,
                email: document.getElementById('reg-email').value,
                password: document.getElementById('reg-password').value,
            }
        });
        toast('Account created! Please log in.');
        document.querySelector('[data-tab="login"]').click();
        document.getElementById('login-email').value = document.getElementById('reg-email').value;
        document.getElementById('reg-name').value = '';
        document.getElementById('reg-email').value = '';
        document.getElementById('reg-password').value = '';
    } catch (err) {
        errEl.textContent = err.message;
    }
});

document.getElementById('logout-btn').addEventListener('click', () => {
    token = null;
    teacherName = null;
    localStorage.removeItem('gradiq_token');
    localStorage.removeItem('gradiq_name');
    document.getElementById('auth-screen').classList.add('active');
    document.getElementById('dashboard-screen').classList.remove('active');
});

// ── Navigation ────────────────────────────────────────────────

function showView(viewId) {
    document.querySelectorAll('#dashboard-screen main > section').forEach(s => s.classList.add('hidden'));
    document.getElementById(viewId).classList.remove('hidden');
    if (viewId === 'test-list-view') loadTests();
}

function enterDashboard() {
    document.getElementById('auth-screen').classList.remove('active');
    document.getElementById('dashboard-screen').classList.add('active');
    document.getElementById('teacher-name').textContent = teacherName;
    showView('test-list-view');
}

// ── Tests ─────────────────────────────────────────────────────

async function loadTests() {
    try {
        const tests = await api('/api/tests');
        const grid = document.getElementById('tests-grid');
        if (tests.length === 0) {
            grid.innerHTML = '<p class="empty-state">No tests yet. Create your first test to get started!</p>';
            return;
        }
        grid.innerHTML = tests.map(t => `
            <div class="test-card" onclick="viewTest(${t.id})">
                <h3>${esc(t.name)}</h3>
                <span class="subject-badge">${esc(t.subject)}</span>
                <div class="card-stats">
                    <span>${t.num_questions} questions</span>
                    <span>${t.total_marks} marks</span>
                </div>
                <div class="key-status pending">Click to view details</div>
            </div>
        `).join('');
    } catch (err) {
        toast(err.message, true);
    }
}

document.getElementById('new-test-btn').addEventListener('click', () => showView('create-test-view'));

document.getElementById('create-test-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        const data = await api('/api/tests', {
            method: 'POST',
            body: {
                name: document.getElementById('test-name').value,
                subject: document.getElementById('test-subject').value,
                total_marks: parseInt(document.getElementById('test-marks').value),
                num_questions: parseInt(document.getElementById('test-questions').value),
            }
        });
        toast('Test created!');
        document.getElementById('create-test-form').reset();
        openAnswerKeyEditor(data.id);
    } catch (err) {
        toast(err.message, true);
    }
});

// ── Answer Key Editor ─────────────────────────────────────────

async function openAnswerKeyEditor(testId) {
    try {
        const test = await api(`/api/tests/${testId}`);
        currentTestId = testId;
        document.getElementById('ak-test-name').textContent = test.name;
        document.getElementById('ak-test-meta').textContent = `${test.subject} · ${test.num_questions} questions · ${test.total_marks} marks`;

        const grid = document.getElementById('answer-key-grid');
        const existingAnswers = {};
        (test.answer_key || []).forEach(a => { existingAnswers[a.question_number] = a.correct_answer; });

        grid.innerHTML = '';
        for (let i = 1; i <= test.num_questions; i++) {
            const selected = existingAnswers[i] || '';
            grid.innerHTML += `
                <div class="ak-item">
                    <span class="q-num">Q${i}</span>
                    <select data-q="${i}">
                        <option value="" ${!selected ? 'selected' : ''}>—</option>
                        <option value="A" ${selected === 'A' ? 'selected' : ''}>A</option>
                        <option value="B" ${selected === 'B' ? 'selected' : ''}>B</option>
                        <option value="C" ${selected === 'C' ? 'selected' : ''}>C</option>
                        <option value="D" ${selected === 'D' ? 'selected' : ''}>D</option>
                    </select>
                </div>
            `;
        }
        showView('answer-key-view');
    } catch (err) {
        toast(err.message, true);
    }
}

document.getElementById('save-key-btn').addEventListener('click', async () => {
    const selects = document.querySelectorAll('#answer-key-grid select');
    const answers = [];
    let allFilled = true;
    selects.forEach(sel => {
        if (!sel.value) allFilled = false;
        answers.push({ question_number: parseInt(sel.dataset.q), correct_answer: sel.value });
    });
    if (!allFilled) {
        toast('Please fill in all answers before saving.', true);
        return;
    }
    try {
        await api(`/api/tests/${currentTestId}/answer-key`, {
            method: 'POST',
            body: { answers }
        });
        toast('Answer key saved!');
        viewTest(currentTestId);
    } catch (err) {
        toast(err.message, true);
    }
});

// ── Test Detail ───────────────────────────────────────────────

async function viewTest(testId) {
    try {
        const [test, results] = await Promise.all([
            api(`/api/tests/${testId}`),
            api(`/api/tests/${testId}/results`),
        ]);
        currentTestId = testId;
        document.getElementById('detail-test-name').textContent = test.name;
        document.getElementById('detail-test-meta').textContent =
            `${test.subject} · ${test.num_questions} questions · ${test.total_marks} marks`;

        const akDisplay = document.getElementById('detail-answer-key');
        if (test.answer_key && test.answer_key.length > 0) {
            akDisplay.innerHTML = test.answer_key.map(a =>
                `<div class="ak-pill"><span class="q">Q${a.question_number}</span><span class="a">${a.correct_answer}</span></div>`
            ).join('');
        } else {
            akDisplay.innerHTML = '<p class="no-key-msg">No answer key set yet.</p>';
        }

        renderResultsTable(results);

        document.getElementById('grade-btn').onclick = () => openGradeView(testId, test);
        document.getElementById('batch-grade-btn').onclick = () => openBatchGradeView(testId, test);
        document.getElementById('edit-key-btn').onclick = () => openAnswerKeyEditor(testId);
        document.getElementById('clear-results-btn').onclick = () => clearAllResults(testId);
        document.getElementById('delete-test-btn').onclick = () => deleteTest(testId);

        showView('test-detail-view');
    } catch (err) {
        toast(err.message, true);
    }
}

function renderResultsTable(results) {
    const wrap = document.getElementById('results-table-wrap');
    const countEl = document.getElementById('results-count');
    if (!results || results.length === 0) {
        wrap.innerHTML = '<p class="no-results-msg">No students graded yet.</p>';
        countEl.textContent = '';
        return;
    }
    countEl.textContent = `${results.length} student${results.length > 1 ? 's' : ''}`;

    const ranked = [...results].sort((a, b) => b.percentage - a.percentage);
    currentResults = {};
    ranked.forEach(r => { currentResults[r.id] = r; });
    const avgPct = (ranked.reduce((s, r) => s + r.percentage, 0) / ranked.length).toFixed(1);
    const highest = ranked[0];
    const lowest = ranked[ranked.length - 1];

    wrap.innerHTML = `
        <div class="results-summary">
            <div class="summary-stat">
                <span class="summary-value">${ranked.length}</span>
                <span class="summary-label">Students Graded</span>
            </div>
            <div class="summary-stat">
                <span class="summary-value">${avgPct}%</span>
                <span class="summary-label">Class Average</span>
            </div>
            <div class="summary-stat highlight-good">
                <span class="summary-value">${highest.percentage}%</span>
                <span class="summary-label">Highest Score</span>
            </div>
            <div class="summary-stat highlight-low">
                <span class="summary-value">${lowest.percentage}%</span>
                <span class="summary-label">Lowest Score</span>
            </div>
        </div>
        <div class="table-scroll">
        <table class="results-table">
            <thead>
                <tr>
                    <th>#</th>
                    <th>Student Name</th>
                    <th>Child Code</th>
                    <th>Score</th>
                    <th>Percentage</th>
                    <th>Grade</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                ${ranked.map((r, i) => `
                    <tr>
                        <td class="rank-cell">${i + 1}</td>
                        <td>${esc(r.student_name)}</td>
                        <td class="code-cell">${r.child_code ? `<span class="child-code">${esc(r.child_code)}</span><button class="copy-code-btn" onclick="copyCode('${r.child_code}')" title="Copy code">copy</button>` : '<span class="no-code">&mdash;</span>'}</td>
                        <td class="score-cell" id="score-${r.id}">
                            <span class="score-display">${r.score} / ${r.total_marks}</span>
                            <button class="edit-score-btn" onclick="editScore(${r.id})" title="Edit score">&#9998;</button>
                        </td>
                        <td>${r.percentage}%</td>
                        <td><span class="grade-pill grade-${gradeClass(r.grade)}">${esc(r.grade)}</span></td>
                        <td class="actions-cell">
                            <button class="action-btn pdf-btn" onclick="downloadPdf(${r.id})" title="Download PDF">PDF</button>
                            <button class="action-btn wa-btn" onclick="shareWhatsAppById(${r.id})" title="Share on WhatsApp">WA</button>
                            <button class="del-btn" onclick="deleteResult(${r.id})" title="Delete">&times;</button>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
        </div>
    `;
}

function editScore(resultId) {
    const r = currentResults[resultId];
    if (!r) return;
    const cell = document.getElementById(`score-${resultId}`);
    cell.innerHTML = `
        <div class="score-edit">
            <input type="number" class="score-input" id="score-input-${resultId}"
                   value="${r.score}" min="0" max="${r.total_marks}" step="any">
            <span class="score-max">/ ${r.total_marks}</span>
            <button class="save-score-btn" onclick="saveScore(${resultId})" title="Save">&#10003;</button>
            <button class="cancel-score-btn" onclick="cancelEditScore(${resultId})" title="Cancel">&#10005;</button>
        </div>
    `;
    const input = document.getElementById(`score-input-${resultId}`);
    input.focus();
    input.select();
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveScore(resultId);
        if (e.key === 'Escape') cancelEditScore(resultId);
    });
}

function cancelEditScore(resultId) {
    const r = currentResults[resultId];
    if (!r) return;
    const cell = document.getElementById(`score-${resultId}`);
    cell.innerHTML = `
        <span class="score-display">${r.score} / ${r.total_marks}</span>
        <button class="edit-score-btn" onclick="editScore(${r.id})" title="Edit score">&#9998;</button>
    `;
}

async function saveScore(resultId) {
    const input = document.getElementById(`score-input-${resultId}`);
    const newScore = parseFloat(input.value);
    const r = currentResults[resultId];
    if (isNaN(newScore) || newScore < 0 || newScore > r.total_marks) {
        toast(`Score must be between 0 and ${r.total_marks}`, true);
        return;
    }
    try {
        await api(`/api/results/${resultId}/score`, {
            method: 'PATCH',
            body: { score: newScore }
        });
        toast('Score updated!');
        viewTest(currentTestId);
    } catch (err) {
        toast(err.message, true);
    }
}

function gradeClass(grade) {
    if (grade === 'A+' || grade === 'A') return 'a';
    if (grade === 'B') return 'b';
    if (grade === 'C') return 'c';
    if (grade === 'D') return 'd';
    return 'f';
}

async function downloadPdf(resultId) {
    try {
        const res = await fetch(`/api/results/${resultId}/pdf`, {
            headers: { 'Authorization': `Bearer ${token}` },
        });
        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.detail || 'PDF generation failed');
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const disposition = res.headers.get('Content-Disposition') || '';
        const match = disposition.match(/filename="?(.+?)"?$/);
        a.download = match ? match[1] : 'report.pdf';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    } catch (err) {
        toast(err.message, true);
    }
}

function shareWhatsApp(studentName, score, percentage, grade) {
    const text = `*GradiQ Report*\n\nStudent: ${studentName}\nScore: ${score}\nPercentage: ${percentage}%\nGrade: ${grade}\n\nGenerated by GradiQ`;
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
}

function shareWhatsAppById(resultId) {
    const r = currentResults[resultId];
    if (r) shareWhatsApp(r.student_name, `${r.score}/${r.total_marks}`, r.percentage, r.grade);
}

async function deleteResult(resultId) {
    if (!confirm('Delete this student result?')) return;
    try {
        await api(`/api/results/${resultId}`, { method: 'DELETE' });
        toast('Result deleted.');
        viewTest(currentTestId);
    } catch (err) {
        toast(err.message, true);
    }
}

async function clearAllResults(testId) {
    if (!confirm('Are you sure you want to delete all student results for this test?')) return;
    try {
        await api(`/api/tests/${testId}/results`, { method: 'DELETE' });
        toast('All results cleared.');
        viewTest(testId);
    } catch (err) {
        toast(err.message, true);
    }
}

async function deleteTest(testId) {
    if (!confirm('Are you sure you want to delete this test?')) return;
    try {
        await api(`/api/tests/${testId}`, { method: 'DELETE' });
        toast('Test deleted.');
        showView('test-list-view');
    } catch (err) {
        toast(err.message, true);
    }
}

// ── Grading ──────────────────────────────────────────────────

function openGradeView(testId, test) {
    currentTestId = testId;
    document.getElementById('grade-test-info').textContent =
        `${test.name} · ${test.subject} · ${test.num_questions} questions · ${test.total_marks} marks`;
    document.getElementById('grade-form').reset();
    document.getElementById('upload-preview').classList.add('hidden');
    document.getElementById('upload-placeholder').classList.remove('hidden');
    document.getElementById('grade-result').classList.add('hidden');
    document.getElementById('grade-form').classList.remove('hidden');
    document.getElementById('grade-submit-btn').classList.remove('loading');
    document.getElementById('grade-submit-btn').textContent = 'Upload & Grade';
    document.getElementById('grade-back-btn').onclick = () => viewTest(testId);
    document.getElementById('back-to-test-btn').onclick = () => viewTest(testId);
    document.getElementById('grade-another-btn').onclick = () => openGradeView(testId, test);
    showView('grade-view');
}

// Image preview
document.getElementById('answer-sheet-input').addEventListener('change', function () {
    const file = this.files[0];
    const preview = document.getElementById('upload-preview');
    const placeholder = document.getElementById('upload-placeholder');
    if (file) {
        const url = URL.createObjectURL(file);
        preview.src = url;
        preview.classList.remove('hidden');
        placeholder.classList.add('hidden');
    } else {
        preview.classList.add('hidden');
        placeholder.classList.remove('hidden');
    }
});

// Drag & drop
const uploadArea = document.getElementById('upload-area');
['dragenter', 'dragover'].forEach(e => uploadArea.addEventListener(e, (ev) => {
    ev.preventDefault();
    uploadArea.classList.add('dragover');
}));
['dragleave', 'drop'].forEach(e => uploadArea.addEventListener(e, (ev) => {
    ev.preventDefault();
    uploadArea.classList.remove('dragover');
}));
uploadArea.addEventListener('drop', (ev) => {
    const file = ev.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
        const input = document.getElementById('answer-sheet-input');
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event('change'));
    }
});

// Submit grading
document.getElementById('grade-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('grade-submit-btn');
    btn.classList.add('loading');
    btn.textContent = 'Analyzing with AI...';

    const formData = new FormData();
    formData.append('student_name', document.getElementById('student-name').value);
    formData.append('answer_sheet', document.getElementById('answer-sheet-input').files[0]);

    try {
        const res = await fetch(`/api/tests/${currentTestId}/grade`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Grading failed');

        document.getElementById('grade-form').classList.add('hidden');
        showGradeResult(data);
    } catch (err) {
        toast(err.message, true);
        btn.classList.remove('loading');
        btn.textContent = 'Upload & Grade';
    }
});

function showGradeResult(data) {
    document.getElementById('res-student').textContent = data.student_name;
    document.getElementById('res-score').textContent = `${data.score} / ${data.total_marks}`;
    document.getElementById('res-pct').textContent = `${data.percentage}%`;
    document.getElementById('res-grade').textContent = data.grade;

    const grid = document.getElementById('comparison-grid');
    grid.innerHTML = data.comparison.map(c => {
        const cls = c.is_correct ? 'correct' : 'wrong';
        const label = c.is_correct ? c.student_answer : `${c.student_answer} (${c.correct_answer})`;
        return `<div class="cmp-item ${cls}"><span class="cmp-q">Q${c.question_number}</span><span class="cmp-a">${esc(label)}</span></div>`;
    }).join('');

    document.getElementById('res-pdf-btn').onclick = () => downloadPdf(data.result_id);
    document.getElementById('res-wa-btn').onclick = () =>
        shareWhatsApp(data.student_name, `${data.score}/${data.total_marks}`, data.percentage, data.grade);

    document.getElementById('grade-result').classList.remove('hidden');
}

// ── Batch Grading ────────────────────────────────────────────

let batchFiles = [];

function openBatchGradeView(testId, test) {
    currentTestId = testId;
    document.getElementById('batch-test-info').textContent =
        `${test.name} · ${test.subject} · ${test.num_questions} questions · ${test.total_marks} marks`;

    document.getElementById('batch-upload-step').classList.remove('hidden');
    document.getElementById('batch-progress-step').classList.add('hidden');
    document.getElementById('batch-complete-step').classList.add('hidden');
    document.getElementById('batch-file-list').classList.add('hidden');
    document.getElementById('batch-file-list').innerHTML = '';
    document.getElementById('batch-grade-all-btn').classList.add('hidden');
    document.getElementById('batch-file-input').value = '';
    document.getElementById('batch-camera-input').value = '';
    document.getElementById('batch-upload-placeholder').classList.remove('hidden');
    batchFiles = [];

    document.getElementById('batch-back-btn').onclick = () => viewTest(testId);
    document.getElementById('batch-view-results-btn').onclick = () => viewTest(testId);

    showView('batch-grade-view');
}

document.getElementById('batch-file-input').addEventListener('change', function () {
    const newFiles = Array.from(this.files);
    if (newFiles.length > 0) {
        batchFiles = batchFiles.concat(newFiles);
        renderBatchFileList();
    }
});

document.getElementById('batch-camera-input').addEventListener('change', function () {
    const file = this.files[0];
    if (file) {
        batchFiles.push(file);
        this.value = '';
        renderBatchFileList();
    }
});

document.getElementById('batch-camera-btn').addEventListener('click', function () {
    document.getElementById('batch-camera-input').click();
});

const batchUploadArea = document.getElementById('batch-upload-area');
['dragenter', 'dragover'].forEach(e => batchUploadArea.addEventListener(e, (ev) => {
    ev.preventDefault();
    batchUploadArea.classList.add('dragover');
}));
['dragleave', 'drop'].forEach(e => batchUploadArea.addEventListener(e, (ev) => {
    ev.preventDefault();
    batchUploadArea.classList.remove('dragover');
}));
batchUploadArea.addEventListener('drop', (ev) => {
    const files = Array.from(ev.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (files.length > 0) {
        batchFiles = batchFiles.concat(files);
        renderBatchFileList();
    }
});

function renderBatchFileList() {
    const list = document.getElementById('batch-file-list');
    const placeholder = document.getElementById('batch-upload-placeholder');

    const savedNames = [];
    for (let i = 0; ; i++) {
        const input = document.getElementById(`batch-name-${i}`);
        if (!input) break;
        savedNames[i] = input.value;
    }

    if (batchFiles.length === 0) {
        list.classList.add('hidden');
        document.getElementById('batch-grade-all-btn').classList.add('hidden');
        placeholder.classList.remove('hidden');
        return;
    }

    placeholder.classList.add('hidden');
    list.classList.remove('hidden');
    document.getElementById('batch-grade-all-btn').classList.remove('hidden');

    list.innerHTML = `<p class="batch-file-count">${batchFiles.length} photo${batchFiles.length > 1 ? 's' : ''} selected</p>` +
        batchFiles.map((file, i) => {
            const url = URL.createObjectURL(file);
            return `
                <div class="batch-file-item">
                    <img src="${url}" class="batch-thumb" alt="Photo ${i + 1}">
                    <input type="text" class="batch-name-input" id="batch-name-${i}"
                           placeholder="Student name">
                </div>
            `;
        }).join('');

    savedNames.forEach((name, i) => {
        const input = document.getElementById(`batch-name-${i}`);
        if (input && name) input.value = name;
    });
}

document.getElementById('batch-grade-all-btn').addEventListener('click', async () => {
    const names = [];
    for (let i = 0; i < batchFiles.length; i++) {
        const name = document.getElementById(`batch-name-${i}`).value.trim();
        if (!name) {
            toast('Please enter a name for every student.', true);
            document.getElementById(`batch-name-${i}`).focus();
            return;
        }
        names.push(name);
    }

    document.getElementById('batch-upload-step').classList.add('hidden');
    document.getElementById('batch-progress-step').classList.remove('hidden');

    const progressBar = document.getElementById('batch-progress-bar');
    const progressText = document.getElementById('batch-progress-text');

    let graded = 0;
    let failed = 0;
    const failures = [];

    for (let i = 0; i < batchFiles.length; i++) {
        const studentName = names[i];
        progressText.textContent = `Grading ${studentName}... ${i + 1} of ${batchFiles.length}`;
        progressBar.style.width = `${(i / batchFiles.length) * 100}%`;

        try {
            const formData = new FormData();
            formData.append('student_name', studentName);
            formData.append('answer_sheet', batchFiles[i]);

            const res = await fetch(`/api/tests/${currentTestId}/grade-batch-item`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData,
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Grading failed');
            graded++;
        } catch (err) {
            failed++;
            failures.push({ name: studentName, error: err.message });
        }

        progressBar.style.width = `${((i + 1) / batchFiles.length) * 100}%`;
    }

    document.getElementById('batch-progress-step').classList.add('hidden');
    document.getElementById('batch-complete-step').classList.remove('hidden');

    document.getElementById('batch-total').textContent = batchFiles.length;
    document.getElementById('batch-success').textContent = graded;
    document.getElementById('batch-failed').textContent = failed;

    const failuresEl = document.getElementById('batch-failures');
    if (failures.length > 0) {
        failuresEl.classList.remove('hidden');
        failuresEl.innerHTML = '<h4>Failed:</h4>' +
            failures.map(f => `<p class="batch-failure-item">${esc(f.name)}: ${esc(f.error)}</p>`).join('');
    } else {
        failuresEl.classList.add('hidden');
    }
});

// ── Utilities ─────────────────────────────────────────────────

function esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

function copyCode(code) {
    navigator.clipboard.writeText(code).then(() => toast('Code copied!'));
}

// ── Init ──────────────────────────────────────────────────────

if (token) {
    enterDashboard();
}
