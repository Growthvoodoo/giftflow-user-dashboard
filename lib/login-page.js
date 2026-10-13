const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function loginPage(error = "", username = "") {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Log in · GiftFlow Dashboard</title>
<link rel="stylesheet" href="/styles.css">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
</head>
<body class="login">
  <main class="login__card">
    <div class="brand"><span class="brand__mark" aria-hidden="true">✉</span> GiftFlow Dashboard</div>
    <h1>Log in</h1>
    ${error ? `<p class="alert alert--error" role="alert">${esc(error)}</p>` : ""}
    <form method="post" action="/login">
      <label>Username<input name="username" autocomplete="username" required autofocus value="${esc(username)}"></label>
      <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
      <button class="btn btn--primary btn--block" type="submit">Log in</button>
    </form>
    <p class="muted small">No account? Ask whoever runs this dashboard to add you.</p>
  </main>
</body></html>`;
}
