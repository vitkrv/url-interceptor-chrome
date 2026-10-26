fetch(chrome.runtime.getURL('package.json'))
  .then(response => {
    if (!response.ok) throw new Error('Unable to load package version');
    return response.json();
  })
  .then(({ version }) => {
    document.getElementById('appVersion').textContent = `v${version}`;
  })
  .catch(error => console.error('Unable to display app version:', error));
