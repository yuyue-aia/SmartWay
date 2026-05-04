const BASE_NAMES = {
  5: '五进制',
  10: '十进制',
  16: '十六进制'
};

const config = window.BASE_CONVERSION_TASK;
const questions = config.questions;
const stateKey = `smartway.baseConversion.${config.childId}.answers`;
let lastResult = null;

const titleEl = document.getElementById('title');
const subtitleEl = document.getElementById('subtitle');
const questionGridEl = document.getElementById('questionGrid');
const scoreEl = document.getElementById('score');
const checkBtn = document.getElementById('checkBtn');
const resetBtn = document.getElementById('resetBtn');
const saveBtn = document.getElementById('saveBtn');
const saveStatusEl = document.getElementById('saveStatus');

titleEl.textContent = `${config.childName} · 进制转换`;
subtitleEl.textContent = config.description || `共 ${questions.length} 道题：包含十进制转五进制/十六进制、反向转换，以及五进制和十六进制之间的转换。`;

function getBaseName(base) {
  return BASE_NAMES[base] || `${base}进制`;
}

function formatRadixText(value, base) {
  return `(${value})_${base}`;
}

function appendRadixExpression(parent, value, base) {
  const expression = document.createElement('span');
  expression.className = 'radix-expression';

  const body = document.createElement('span');
  body.textContent = `(${value})`;

  const sub = document.createElement('sub');
  sub.textContent = base;

  expression.append(body, sub);
  parent.appendChild(expression);
}

function getPrompt(question) {
  return `将 ${formatRadixText(question.value, question.fromBase)} 转换为 ${getBaseName(question.toBase)}`;
}

function normalizeAnswer(value) {
  return value.trim().replace(/^0x/i, '').toUpperCase();
}

function loadAnswers() {
  try {
    const data = JSON.parse(sessionStorage.getItem(stateKey) || '[]');
    return Array.isArray(data) ? data : [];
  } catch (error) {
    return [];
  }
}

function saveAnswers() {
  const answers = [...questionGridEl.querySelectorAll('.answer-input')].map(input => input.value);
  sessionStorage.setItem(stateKey, JSON.stringify(answers));
  saveStatusEl.textContent = '答案已自动保留';
}

function clearAnswers() {
  sessionStorage.removeItem(stateKey);
}

function renderQuestions() {
  const savedAnswers = loadAnswers();
  questionGridEl.innerHTML = '';
  questions.forEach((question, index) => {
    const card = document.createElement('article');
    card.className = 'question-card';
    card.dataset.index = index;

    const head = document.createElement('div');
    head.className = 'question-head';

    const num = document.createElement('div');
    num.className = 'question-index';
    num.textContent = `第 ${index + 1} 题`;

    const badge = document.createElement('div');
    badge.className = 'badge';
    badge.textContent = `${question.fromBase} → ${question.toBase}`;

    const prompt = document.createElement('div');
    prompt.className = 'prompt';

    const promptLabel = document.createElement('div');
    promptLabel.className = 'prompt-label';
    promptLabel.textContent = '请完成下面的进制转换';

    const promptLine = document.createElement('div');
    promptLine.className = 'prompt-line';
    appendRadixExpression(promptLine, question.value, question.fromBase);

    const arrow = document.createElement('span');
    arrow.className = 'convert-arrow';
    arrow.textContent = '→';

    promptLine.appendChild(arrow);
    appendRadixExpression(promptLine, '?', question.toBase);
    prompt.append(promptLabel, promptLine);

    const answerRow = document.createElement('div');
    answerRow.className = 'answer-row';

    const input = document.createElement('input');
    input.className = 'answer-input';
    input.type = 'text';
    input.placeholder = '填写答案';
    input.autocomplete = 'off';
    input.value = savedAnswers[index] || '';
    input.addEventListener('input', saveAnswers);
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') checkAll();
    });

    const feedback = document.createElement('div');
    feedback.className = 'feedback';

    head.append(num, badge);
    answerRow.appendChild(input);
    card.append(head, prompt, answerRow, feedback);
    questionGridEl.appendChild(card);
  });
}

function checkAll() {
  saveAnswers();
  let correct = 0;
  let answered = 0;
  const wrongItems = [];

  [...questionGridEl.querySelectorAll('.question-card')].forEach(card => {
    const index = Number(card.dataset.index);
    const question = questions[index];
    const input = card.querySelector('.answer-input');
    const feedback = card.querySelector('.feedback');
    const answer = normalizeAnswer(input.value);

    if (!answer) {
      card.classList.remove('correct', 'wrong');
      feedback.textContent = '';
      return;
    }

    answered += 1;
    const expected = normalizeAnswer(question.answer);
    const isCorrect = answer === expected;

    card.classList.toggle('correct', isCorrect);
    card.classList.toggle('wrong', !isCorrect);

    if (isCorrect) {
      correct += 1;
      feedback.textContent = '正确';
    } else {
      feedback.textContent = `正确答案：${formatRadixText(question.answer, question.toBase)}`;
      wrongItems.push(getPrompt(question));
    }
  });

  lastResult = { correct, total: answered, wrongItems };
  scoreEl.textContent = `${correct}/${answered}`;
  saveBtn.disabled = answered === 0;
  saveStatusEl.textContent = answered === 0 ? '还没有填写答案' : `已批改 ${answered} 道题，可保存成绩`;
}

function resetAll() {
  lastResult = null;
  clearAnswers();
  scoreEl.textContent = `0/${questions.length}`;
  saveBtn.disabled = true;
  saveStatusEl.textContent = '';
  questionGridEl.querySelectorAll('.question-card').forEach(card => {
    card.classList.remove('correct', 'wrong');
    card.querySelector('.answer-input').value = '';
    card.querySelector('.feedback').textContent = '';
  });
}

async function saveResult() {
  if (!lastResult) return;

  saveBtn.disabled = true;
  saveStatusEl.textContent = '正在保存...';

  try {
    const response = await fetch(`/api/children/${encodeURIComponent(config.childId)}/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId: 'base_conversion',
        total: lastResult.total,
        correct: lastResult.correct,
        wrongItems: lastResult.wrongItems
      })
    });

    if (!response.ok) throw new Error(`保存失败：${response.status}`);
    saveStatusEl.textContent = '成绩已保存';
  } catch (error) {
    console.error(error);
    saveStatusEl.textContent = '保存失败，请确认后端服务正常';
    saveBtn.disabled = false;
  }
}

checkBtn.addEventListener('click', checkAll);
resetBtn.addEventListener('click', resetAll);
saveBtn.addEventListener('click', saveResult);

renderQuestions();
scoreEl.textContent = `0/${questions.length}`;
if (loadAnswers().some(Boolean)) {
  saveStatusEl.textContent = '已恢复上次填写的答案';
}
