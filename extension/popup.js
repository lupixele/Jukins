document.addEventListener('DOMContentLoaded', async () => {
  const button = document.getElementById('toggle-runner');
  const options = document.querySelectorAll('.speed-opt');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  async function send(message) {
    try {
      const state = await chrome.tabs.sendMessage(tab.id, message);
      button.textContent = state.enabled ? 'Pause this tab' : 'Start this tab';
      options.forEach(o => o.classList.toggle('active', Number(o.dataset.speed) === state.speed));
    } catch (e) { button.textContent = 'Refresh the course tab'; button.disabled = true; }
  }
  button.addEventListener('click', () => send({ type: 'JUKINS_TOGGLE' }));
  options.forEach(o => o.addEventListener('click', () => send({ type: 'JUKINS_SPEED', speed: Number(o.dataset.speed) })));
  await send({ type: 'JUKINS_STATE' });
});

