const dot = document.getElementById('dot');
const label = document.getElementById('label');
const btn = document.getElementById('btn');
const tokenInput = document.getElementById('token');
const tokenHint = document.getElementById('tokenHint');

function updateUI(connected, hasToken) {
  dot.className = connected ? 'dot on' : 'dot off';
  label.textContent = connected ? 'Connected' : 'Disconnected';
  btn.textContent = connected ? 'Disconnect' : 'Connect';
  if (hasToken) {
    tokenHint.textContent = 'Token saved';
  } else {
    tokenHint.textContent = 'No token set — paste one to connect';
  }
}

// Load saved token for display hint
chrome.storage.local.get('token', (result) => {
  if (result.token) {
    tokenInput.value = result.token;
  }
});

// Get initial state
chrome.runtime.sendMessage({ type: 'getState' }, (res) => {
  if (res) updateUI(res.connected, res.hasToken);
});

// Listen for state changes
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'connectionState') updateUI(msg.connected, true);
});

// Toggle connection
btn.addEventListener('click', () => {
  const isConnected = dot.classList.contains('on');
  if (isConnected) {
    chrome.runtime.sendMessage({ type: 'disconnect' });
  } else {
    // Save token if changed
    const newToken = tokenInput.value.trim();
    if (newToken) {
      chrome.runtime.sendMessage({ type: 'setToken', token: newToken });
    }
    chrome.runtime.sendMessage({ type: 'connect' });
  }
});
