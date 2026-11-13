// The start screen: in the theme Slider will open in (`?theme=`), the logo playing the web app's
// animations one after another, a different one each time – as long as Slider starts.
/* global window, document, location, getComputedStyle, setTimeout, URLSearchParams */
const theme = new URLSearchParams(location.search).get('theme');
if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;

const logo = document.querySelector('.logo');
// generated/logo-animations.js, from the web app's stylesheet: no second list to keep in step.
const animations = window.LOGO_ANIMATIONS ?? [];
let last = null;

function play() {
  if (!animations.length) return;
  const others = animations.filter((name) => name !== last);
  last = others[Math.floor(Math.random() * others.length)];
  logo.removeAttribute('data-logo-anim');
  void getComputedStyle(logo).animationName; // restart even the same animation
  logo.setAttribute('data-logo-anim', last);
}

logo.addEventListener('animationend', (event) => {
  if (event.target === logo) setTimeout(play, 500);
});
play();
