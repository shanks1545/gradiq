const API = '';
let token = localStorage.getItem('gradiq_token');
let teacherName = localStorage.getItem('gradiq_name');
let instituteName = localStorage.getItem('gradiq_institute');
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
        if (tab.dataset.tab === 'register') clearAuthInputs();
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
        instituteName = json.institute_name || '';
        localStorage.setItem('gradiq_token', token);
        localStorage.setItem('gradiq_name', teacherName);
        localStorage.setItem('gradiq_institute', instituteName);
        enterDashboard();
    } catch (err) {
        errEl.textContent = err.message;
    }
});

document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('auth-error');
    errEl.textContent = '';
    const regEmail = document.getElementById('reg-email').value;
    const regPassword = document.getElementById('reg-password').value;
    const regName = document.getElementById('reg-name').value;
    try {
        await api('/api/register', {
            method: 'POST',
            body: { name: regName, email: regEmail, password: regPassword }
        });
        const loginData = await fetch('/api/login', {
            method: 'POST',
            body: new URLSearchParams({ username: regEmail, password: regPassword }),
        });
        const loginJson = await loginData.json();
        if (!loginData.ok) throw new Error(loginJson.detail);
        token = loginJson.access_token;
        teacherName = loginJson.teacher_name;
        instituteName = loginJson.institute_name || '';
        localStorage.setItem('gradiq_token', token);
        localStorage.setItem('gradiq_name', teacherName);
        localStorage.setItem('gradiq_institute', instituteName);
        localStorage.removeItem('gradiq_onboarded');
        document.getElementById('auth-modal').classList.add('hidden');
        startOnboarding();
    } catch (err) {
        errEl.textContent = err.message;
    }
});

document.getElementById('logout-btn').addEventListener('click', () => {
    token = null;
    teacherName = null;
    instituteName = null;
    localStorage.removeItem('gradiq_token');
    localStorage.removeItem('gradiq_name');
    localStorage.removeItem('gradiq_institute');
    document.getElementById('auth-screen').classList.add('active');
    document.getElementById('auth-modal').classList.add('hidden');
    document.getElementById('dashboard-screen').classList.remove('active');
});

// ── Auth Modal ───────────────────────────────────────────────

function clearAuthInputs() {
    document.querySelectorAll('#auth-modal input').forEach(input => { input.value = ''; input.blur(); });
}
document.getElementById('open-auth-btn').addEventListener('click', () => {
    document.getElementById('auth-modal').classList.remove('hidden');
    clearAuthInputs();
});
document.getElementById('get-started-btn').addEventListener('click', () => {
    document.getElementById('auth-modal').classList.remove('hidden');
    clearAuthInputs();
});
document.getElementById('close-auth-btn').addEventListener('click', () => {
    document.getElementById('auth-modal').classList.add('hidden');
});
document.getElementById('auth-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
});

// ── Navigation ────────────────────────────────────────────────

function showView(viewId) {
    document.querySelectorAll('#dashboard-screen main > section').forEach(s => s.classList.add('hidden'));
    document.getElementById(viewId).classList.remove('hidden');
    if (viewId === 'test-list-view') loadTests();
}

function renderTeacherName() {
    const el = document.getElementById('teacher-name');
    const inst = instituteName ? ` <span class="teacher-name-inst">(${instituteName})</span>` : '';
    el.innerHTML = `<span class="teacher-name-main">${esc(teacherName)}</span>${inst}`;
}

function enterDashboard() {
    document.getElementById('auth-screen').classList.remove('active');
    document.getElementById('auth-modal').classList.add('hidden');
    document.getElementById('dashboard-screen').classList.add('active');
    renderTeacherName();
    showView('test-list-view');
}

// ── Tests ─────────────────────────────────────────────────────

function getGreeting() {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
}

async function loadTests() {
    try {
        const greetEl = document.getElementById('greeting-text');
        if (greetEl) greetEl.textContent = `${getGreeting()}, ${teacherName}.`;

        const tests = await api('/api/tests');
        const grid = document.getElementById('tests-grid');

        let totalStudents = 0;
        const resultCounts = {};
        for (const t of tests) {
            try {
                const results = await api(`/api/tests/${t.id}/results`);
                resultCounts[t.id] = results;
                totalStudents += results.length;
            } catch (_) {
                resultCounts[t.id] = [];
            }
        }

        const savedEl = document.getElementById('time-saved-card');
        if (savedEl) {
            const hours = ((totalStudents * 10) / 60).toFixed(1);
            document.getElementById('time-saved-text').textContent =
                `GradiQ has saved you approximately ${hours} hours this month`;
            savedEl.classList.toggle('hidden', totalStudents === 0);
        }

        if (tests.length === 0) {
            grid.innerHTML = `
                <div class="empty-state-card">
                    <div class="empty-state-shapes">
                        <div class="empty-circle"></div>
                        <div class="empty-lines"><span></span><span></span><span></span></div>
                    </div>
                    <h3 class="empty-title">Ready to grade your first class?</h3>
                    <p class="empty-sub">Create a test and grade students in under 2 minutes.</p>
                    <button class="btn-new-test" onclick="showView('create-test-view')"><span class="btn-new-test-icon">+</span> Create your first test</button>
                </div>`;
            return;
        }

        grid.innerHTML = tests.map((t, idx) => {
            const results = resultCounts[t.id] || [];
            const count = results.length;
            const avgPct = count > 0 ? (results.reduce((s, r) => s + r.percentage, 0) / count).toFixed(0) : 0;
            const date = t.created_at ? new Date(t.created_at + 'Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '';
            const avatars = results.slice(0, 3).map(r => {
                const initials = r.student_name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
                return `<span class="avatar-circle" title="${esc(r.student_name)}">${initials}</span>`;
            }).join('');
            const extra = count > 3 ? `<span class="avatar-extra">+${count - 3}</span>` : '';

            return `
                <div class="test-card" onclick="viewTest(${t.id})" style="animation-delay:${idx * 0.08}s">
                    <div class="tc-top">
                        <span class="subject-badge">${esc(t.subject)}</span>
                        <span class="tc-date">${date}</span>
                    </div>
                    <h3>${esc(t.name)}</h3>
                    <div class="card-stats">
                        <span>${t.num_questions} questions</span>
                        <span>${t.total_marks} marks</span>
                    </div>
                    ${count > 0 ? `
                    <div class="tc-progress">
                        <div class="tc-progress-header">
                            <span class="tc-progress-label">Class average</span>
                            <span class="tc-progress-pct">${avgPct}%</span>
                        </div>
                        <div class="tc-bar-bg"><div class="tc-bar-fill" style="width:${avgPct}%"></div></div>
                    </div>` : '<div class="key-status pending">No students graded yet</div>'}
                    <div class="tc-bottom">
                        <div class="tc-avatars">${avatars}${extra}</div>
                        <span class="tc-grade-btn">Grade &rarr;</span>
                    </div>
                </div>`;
        }).join('');
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
        const qTypes = test.question_types ? (typeof test.question_types === 'string' ? JSON.parse(test.question_types) : test.question_types) : Array(test.num_questions).fill('mcq');

        grid.innerHTML = '';
        for (let i = 1; i <= test.num_questions; i++) {
            const type = qTypes[i - 1] || 'mcq';
            grid.innerHTML += `
                <div class="ak-item">
                    <span class="q-num">Q${i}</span>
                    <select class="type-select" data-q="${i}" onchange="updateAkAnswer(${i})">
                        <option value="mcq" ${type === 'mcq' ? 'selected' : ''}>MCQ</option>
                        <option value="fill" ${type === 'fill' ? 'selected' : ''}>Fill in the Blank</option>
                        <option value="tf" ${type === 'tf' ? 'selected' : ''}>True / False</option>
                    </select>
                    <div class="ak-answer" id="ak-answer-${i}"></div>
                </div>
            `;
        }
        for (let i = 1; i <= test.num_questions; i++) {
            renderAkAnswer(i, qTypes[i - 1] || 'mcq', existingAnswers[i] || '');
        }
        showView('answer-key-view');
    } catch (err) {
        toast(err.message, true);
    }
}

function updateAkAnswer(q) {
    const type = document.querySelector(`.type-select[data-q="${q}"]`).value;
    renderAkAnswer(q, type, '');
}

function renderAkAnswer(q, type, value) {
    const container = document.getElementById(`ak-answer-${q}`);
    if (type === 'mcq') {
        container.innerHTML = `
            <select class="ak-val" data-q="${q}">
                <option value="" ${!value ? 'selected' : ''}>—</option>
                <option value="A" ${value === 'A' ? 'selected' : ''}>A</option>
                <option value="B" ${value === 'B' ? 'selected' : ''}>B</option>
                <option value="C" ${value === 'C' ? 'selected' : ''}>C</option>
                <option value="D" ${value === 'D' ? 'selected' : ''}>D</option>
            </select>`;
    } else if (type === 'fill') {
        container.innerHTML = `<input type="text" class="ak-val ak-fill-input" data-q="${q}" value="${esc(value)}" placeholder="Correct answer">`;
    } else if (type === 'tf') {
        container.innerHTML = `
            <div class="tf-buttons" data-q="${q}">
                <button type="button" class="tf-btn ${value === 'True' ? 'active' : ''}" onclick="selectTf(${q},'True')">True</button>
                <button type="button" class="tf-btn ${value === 'False' ? 'active' : ''}" onclick="selectTf(${q},'False')">False</button>
            </div>`;
    }
}

function selectTf(q, val) {
    const container = document.querySelector(`.tf-buttons[data-q="${q}"]`);
    container.querySelectorAll('.tf-btn').forEach(btn => btn.classList.toggle('active', btn.textContent === val));
    container.dataset.tfValue = val;
}

document.getElementById('save-key-btn').addEventListener('click', async () => {
    const answers = [];
    const question_types = [];
    let allFilled = true;

    const typeSelects = document.querySelectorAll('.type-select');
    typeSelects.forEach(sel => {
        const q = parseInt(sel.dataset.q);
        const type = sel.value;
        question_types.push(type);

        let answer = '';
        if (type === 'mcq') {
            const valSel = document.querySelector(`#ak-answer-${q} select.ak-val`);
            answer = valSel ? valSel.value : '';
        } else if (type === 'fill') {
            const input = document.querySelector(`#ak-answer-${q} input.ak-val`);
            answer = input ? input.value.trim() : '';
        } else if (type === 'tf') {
            const tfContainer = document.querySelector(`#ak-answer-${q} .tf-buttons`);
            answer = tfContainer ? (tfContainer.dataset.tfValue || '') : '';
        }
        if (!answer) allFilled = false;
        answers.push({ question_number: q, correct_answer: answer });
    });

    if (!allFilled) {
        toast('Please fill in all answers before saving.', true);
        return;
    }
    try {
        await api(`/api/tests/${currentTestId}/answer-key`, {
            method: 'POST',
            body: { answers, question_types }
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
            const qTypes = test.question_types ? (typeof test.question_types === 'string' ? JSON.parse(test.question_types) : test.question_types) : [];
            akDisplay.innerHTML = test.answer_key.map((a, idx) => {
                const qt = qTypes[idx] || 'mcq';
                return `<div class="ak-pill ak-pill-${qt}"><span class="q">Q${a.question_number}</span><span class="a">${esc(a.correct_answer)}</span></div>`;
            }).join('');
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
    document.getElementById('grade-submit-btn').textContent = 'Analyze with AI';
    const oldLoading = document.getElementById('grade-loading');
    if (oldLoading) oldLoading.remove();
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
let loadingMsgInterval = null;
document.getElementById('grade-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('grade-submit-btn');
    btn.classList.add('loading');

    const gradeForm = document.getElementById('grade-form');
    gradeForm.classList.add('hidden');

    const loadingEl = document.createElement('div');
    loadingEl.className = 'grade-loading-overlay';
    loadingEl.id = 'grade-loading';
    loadingEl.innerHTML = '<div class="grade-loading-logo">Gradi<span class="accent">Q</span></div><p class="grade-loading-msg"></p>';
    gradeForm.parentNode.insertBefore(loadingEl, gradeForm.nextSibling);

    const messages = ['Reading answer sheet...', 'Detecting answers...', 'Calculating score...', 'Almost done...'];
    let msgIdx = 0;
    const msgEl = loadingEl.querySelector('.grade-loading-msg');
    msgEl.textContent = messages[0];
    loadingMsgInterval = setInterval(() => { msgIdx = (msgIdx + 1) % messages.length; msgEl.textContent = messages[msgIdx]; }, 2000);

    const imageFile = document.getElementById('answer-sheet-input').files[0];
    const imageUrl = imageFile ? URL.createObjectURL(imageFile) : null;

    const formData = new FormData();
    formData.append('student_name', document.getElementById('student-name').value);
    formData.append('answer_sheet', imageFile);

    try {
        const res = await fetch(`/api/tests/${currentTestId}/grade`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Grading failed');

        clearInterval(loadingMsgInterval);
        loadingEl.remove();
        showGradeResult(data, imageUrl);
    } catch (err) {
        clearInterval(loadingMsgInterval);
        loadingEl.remove();
        gradeForm.classList.remove('hidden');
        toast(err.message, true);
        btn.classList.remove('loading');
        btn.textContent = 'Analyze with AI';
    }
});

function animateCount(el, target, suffix, duration) {
    const start = performance.now();
    const step = (now) => {
        const progress = Math.min((now - start) / duration, 1);
        const ease = 1 - Math.pow(1 - progress, 3);
        el.textContent = Math.round(target * ease) + suffix;
        if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
}

function fireConfetti() {
    const canvas = document.createElement('canvas');
    canvas.id = 'confetti-canvas';
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const pieces = Array.from({ length: 120 }, () => ({
        x: canvas.width / 2, y: canvas.height / 2,
        vx: (Math.random() - 0.5) * 16, vy: Math.random() * -14 - 4,
        size: Math.random() * 6 + 3, color: ['#2dd4bf', '#30d158', '#ffd60a', '#ff453a', '#a78bfa', '#fff'][Math.floor(Math.random() * 6)],
        rotation: Math.random() * 360, rotSpeed: (Math.random() - 0.5) * 12, alpha: 1,
    }));
    let frame = 0;
    const animate = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        pieces.forEach(p => {
            p.x += p.vx; p.y += p.vy; p.vy += 0.25; p.rotation += p.rotSpeed;
            p.alpha = Math.max(0, p.alpha - 0.008);
            ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rotation * Math.PI / 180);
            ctx.globalAlpha = p.alpha;
            ctx.fillStyle = p.color; ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
            ctx.restore();
        });
        frame++;
        if (frame < 120) requestAnimationFrame(animate);
        else canvas.remove();
    };
    requestAnimationFrame(animate);
}

function showGradeResult(data, imageUrl) {
    document.getElementById('res-student').textContent = data.student_name;
    animateCount(document.getElementById('res-score'), data.score, ` / ${data.total_marks}`, 800);
    animateCount(document.getElementById('res-pct'), data.percentage, '%', 800);
    const gradeEl = document.getElementById('res-grade');
    gradeEl.textContent = data.grade;
    gradeEl.classList.remove('grade-spring');
    void gradeEl.offsetWidth;
    gradeEl.classList.add('grade-spring');
    if (data.grade === 'A+') setTimeout(fireConfetti, 400);

    const grid = document.getElementById('comparison-grid');
    grid.innerHTML = data.comparison.map(c => {
        const cls = c.is_correct ? 'correct' : 'wrong';
        const label = c.is_correct ? c.student_answer : `${c.student_answer} (${c.correct_answer})`;
        const qt = c.question_type || 'mcq';
        const typeLabel = { mcq: 'M', fill: 'F', tf: 'T/F' }[qt] || 'M';
        const conf = c.confidence || 'high';
        const confCls = { high: 'conf-high', medium: 'conf-med', low: 'conf-low' }[conf] || 'conf-high';
        const confWarn = conf === 'low' ? '<span class="conf-warn">Please verify</span>' : '';
        const lowCls = conf === 'low' ? ' cmp-low-conf' : '';
        return `<div class="cmp-item ${cls}${lowCls}"><span class="cmp-q">Q${c.question_number}</span><span class="cmp-type">${typeLabel}</span><span class="conf-dot ${confCls}"></span><span class="cmp-a">${esc(label)}</span>${confWarn}</div>`;
    }).join('');

    const annotSection = document.getElementById('annotation-section');
    if (imageUrl) {
        annotSection.classList.remove('hidden');
        document.getElementById('annotation-img').src = imageUrl;
        const container = document.getElementById('annotation-container');
        container.querySelectorAll('.annot-box').forEach(el => el.remove());

        const numQ = data.comparison.length;
        const cols = numQ <= 5 ? 1 : numQ <= 20 ? 2 : 3;
        const rows = Math.ceil(numQ / cols);
        const pad = 0.8;

        data.comparison.forEach((c, i) => {
            const col = Math.floor(i / rows);
            const row = i % rows;
            const box = document.createElement('div');
            box.className = `annot-box ${c.is_correct ? 'annot-correct' : 'annot-wrong'}`;
            box.style.cssText = `left:${(col / cols) * 100 + pad}%;top:${(row / rows) * 100 + pad}%;width:${(1 / cols) * 100 - pad * 2}%;height:${(1 / rows) * 100 - pad * 2}%`;
            box.innerHTML = `<span class="annot-label">Q${c.question_number}</span>`;
            container.appendChild(box);
        });

        document.getElementById('annotation-wrap').classList.add('hidden');
        document.getElementById('annotation-toggle').textContent = 'Show Answer Sheet';
    } else {
        annotSection.classList.add('hidden');
    }

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

document.getElementById('annotation-toggle').addEventListener('click', function () {
    const wrap = document.getElementById('annotation-wrap');
    const isHidden = wrap.classList.toggle('hidden');
    this.textContent = isHidden ? 'Show Answer Sheet' : 'Hide Answer Sheet';
});

// ── Onboarding ───────────────────────────────────────────────

function startOnboarding() {
    document.getElementById('auth-screen').classList.remove('active');
    document.getElementById('dashboard-screen').classList.remove('active');
    document.getElementById('onboarding-screen').classList.add('active');
    document.querySelectorAll('#onboarding-screen input, #onboarding-screen select').forEach(el => {
        if (el.tagName === 'SELECT') el.selectedIndex = 0;
        else el.value = '';
    });
    document.getElementById('ob-welcome').textContent = `Welcome to GradiQ, ${teacherName}!`;
    showObStep(1);
}

function showObStep(n) {
    document.querySelectorAll('.ob-step').forEach(s => s.classList.remove('active'));
    document.getElementById(`ob-step-${n}`).classList.add('active');
    document.getElementById('ob-step-label').textContent = `Step ${n} of 3`;
    for (let i = 1; i <= 3; i++) {
        const dot = document.getElementById(`ob-dot-${i}`);
        dot.classList.toggle('active', i <= n);
    }
    if (n === 3) {
        const check = document.getElementById('ob-check');
        check.classList.remove('ob-check-anim');
        void check.offsetWidth;
        check.classList.add('ob-check-anim');
    }
}

document.getElementById('ob-next-1').addEventListener('click', async () => {
    const inst = document.getElementById('ob-institute').value.trim();
    const city = document.getElementById('ob-city').value.trim();
    if (!inst || !city) { toast('Please fill in institute name and city.', true); return; }
    try {
        await api('/api/profile', {
            method: 'PATCH',
            body: {
                institute_name: inst, city: city,
                board: document.getElementById('ob-board').value,
                student_count: document.getElementById('ob-students').value,
            }
        });
        instituteName = inst;
        localStorage.setItem('gradiq_institute', instituteName);
        showObStep(2);
    } catch (err) { toast(err.message, true); }
});

document.getElementById('ob-next-2').addEventListener('click', async () => {
    const name = document.getElementById('ob-test-name').value.trim();
    const subject = document.getElementById('ob-test-subject').value.trim();
    const questions = parseInt(document.getElementById('ob-test-questions').value);
    const marks = parseInt(document.getElementById('ob-test-marks').value);
    if (!name || !subject || !questions || !marks) { toast('Please fill in all fields.', true); return; }
    try {
        await api('/api/tests', { method: 'POST', body: { name, subject, total_marks: marks, num_questions: questions } });
        showObStep(3);
    } catch (err) { toast(err.message, true); }
});

document.getElementById('ob-skip-2').addEventListener('click', () => showObStep(3));

document.getElementById('ob-finish').addEventListener('click', () => {
    localStorage.setItem('gradiq_onboarded', '1');
    document.getElementById('onboarding-screen').classList.remove('active');
    enterDashboard();
});

// ── Settings ─────────────────────────────────────────────────

document.getElementById('settings-btn').addEventListener('click', async () => {
    try {
        const profile = await api('/api/profile');
        document.getElementById('settings-institute').value = profile.institute_name || '';
        document.getElementById('settings-city').value = profile.city || '';
        document.getElementById('settings-board').value = profile.board || 'CBSE';
    } catch (_) {}
    document.getElementById('settings-modal').classList.remove('hidden');
});

document.getElementById('close-settings-btn').addEventListener('click', () => {
    document.getElementById('settings-modal').classList.add('hidden');
});

document.getElementById('settings-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
});

document.getElementById('save-settings-btn').addEventListener('click', async () => {
    try {
        const res = await api('/api/profile', {
            method: 'PATCH',
            body: {
                institute_name: document.getElementById('settings-institute').value.trim(),
                city: document.getElementById('settings-city').value.trim(),
                board: document.getElementById('settings-board').value,
            }
        });
        instituteName = res.institute_name || '';
        localStorage.setItem('gradiq_institute', instituteName);
        renderTeacherName();
        document.getElementById('settings-modal').classList.add('hidden');
        toast('Settings saved!');
    } catch (err) { toast(err.message, true); }
});

// ── Init ──────────────────────────────────────────────────────

if (token) {
    if (!localStorage.getItem('gradiq_onboarded')) {
        startOnboarding();
    } else {
        enterDashboard();
    }
}
