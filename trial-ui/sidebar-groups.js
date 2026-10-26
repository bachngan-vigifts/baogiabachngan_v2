/** Collapse presentation only; permission-controlled link.hidden values stay untouched. */
export function installSidebarGroups(root = document.querySelector('.sidebar')) {
  for (const group of root?.querySelectorAll('.nav-group') || []) {
    const heading = group.querySelector('.nav-label');
    if (!heading || heading.querySelector('button')) continue;
    const toggle = document.createElement('button'), items = document.createElement('div');
    items.className = 'nav-group-items'; items.id = heading.id + '-items';
    toggle.type = 'button'; toggle.className = 'nav-group-toggle';
    toggle.setAttribute('aria-controls', items.id); toggle.setAttribute('aria-expanded', 'false');
    const title = document.createElement('span'), arrow = document.createElement('span');
    title.textContent = heading.textContent; arrow.className = 'nav-group-arrow'; arrow.textContent = '›'; arrow.setAttribute('aria-hidden', 'true');
    toggle.append(title, arrow); heading.replaceChildren(toggle);
    for (const link of [...group.children].filter(n => n !== heading)) items.append(link);
    group.append(items);
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(open)); group.classList.toggle('is-open', open);
    });
  }
}
