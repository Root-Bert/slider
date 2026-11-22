/* global document, window */
const form = document.getElementById('form');
const server = document.getElementById('server');
const message = document.getElementById('message');

window.cloud.onState((state) => {
  if (!server.value || document.activeElement !== server) server.value = state.server;
  message.textContent =
    state.message ?? (state.waiting ? 'Weiter im Browser. Bestätige dort die Anmeldung.' : '');
});
form.addEventListener('submit', (event) => {
  event.preventDefault();
  message.textContent = '';
  void window.cloud.signIn(server.value);
});
void window.cloud.ready();
