// Still & Golden — shared site behaviour.
// Mobile nav: the hamburger toggles a full-screen menu (body.menu-open);
// it closes via the X button or when any nav link is tapped.
const closeMenu = () => document.body.classList.remove('menu-open');
document.getElementById('ham').addEventListener('click', () => {
  document.body.classList.toggle('menu-open');
});
document.getElementById('menu-close').addEventListener('click', closeMenu);
document.querySelectorAll('.nav-right a').forEach(a =>
  a.addEventListener('click', closeMenu)
);
