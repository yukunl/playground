// The preview gate's sign-in page. Plain HTML, so none of the app loads before
// the password. Colors are the app's own (src/client/index.css), and the theme
// follows the same saved choice as index.html.
export const LOGIN_PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Sign in to Parasail Playground Yukun Demo</title>
    <link
      rel="icon"
      type="image/svg+xml"
      href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 22.2 22'%3E%3Cstyle%3Epath%7Bfill:%23030304%7D@media (prefers-color-scheme:dark)%7Bpath%7Bfill:%23fafafb%7D%7D%3C/style%3E%3Cpath d='M0 14.5313C4.12467 14.5313 7.46831 17.8751 7.46831 21.9996H0V14.5313Z'/%3E%3Cpath fill-rule='evenodd' d='M0 7.04705V7.06376C8.2495 7.06387 14.9366 13.7511 14.9366 22H14.9533L14.9366 21.9674C17.9903 21.7842 23.0622 19.7238 21.803 13.1846C20.1335 6.8501 15.1446 1.86298 8.8093 0.195519C2.27485 -1.05826 0.215833 4.01054 0.0331967 7.0632L0 7.04705Z'/%3E%3C/svg%3E"
    />
    <script>
      ;(function () {
        var theme = null
        try {
          theme = localStorage.getItem('playground.theme')
        } catch (e) {}
        if (theme === 'dark' || (theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches)) {
          document.documentElement.classList.add('dark')
        }
      })()
    </script>
    <style>
      :root {
        color-scheme: light;
        --bg: #ffffff;
        --text: #121315;
        --muted: #6c6d6f;
        --edge: #cdcecf;
        --ink: #030304;
        --ink-text: #ffffff;
        --ink-hover: #3c3d40;
        --focus: #2850e4;
        --error: #b42318;
      }
      .dark {
        color-scheme: dark;
        --bg: #030304;
        --text: #f1f2f2;
        --muted: #8e8f91;
        --edge: #5f6062;
        --ink: #e7e8e9;
        --ink-text: #030304;
        --ink-hover: #ffffff;
        --error: #fda29b;
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 16px;
        background: var(--bg);
        color: var(--text);
        font-family: ui-sans-serif, system-ui, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji';
        -webkit-font-smoothing: antialiased;
      }
      form {
        width: 100%;
        max-width: 320px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        /* Sit a little above center, like a dialog. */
        margin-bottom: 10vh;
      }
      svg {
        width: 28px;
        height: 28px;
        margin-bottom: 8px;
      }
      h1 {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
      }
      p {
        margin: 0 0 8px;
        font-size: 14px;
        line-height: 1.45;
        color: var(--muted);
      }
      input,
      button {
        font: inherit;
        font-size: 14px;
        border-radius: 6px;
        padding: 8px 12px;
      }
      input {
        border: 1px solid var(--edge);
        background: transparent;
        color: inherit;
      }
      input:focus-visible,
      button:focus-visible {
        outline: 2px solid var(--focus);
        outline-offset: 2px;
      }
      button {
        border: 0;
        font-weight: 500;
        background: var(--ink);
        color: var(--ink-text);
        cursor: pointer;
      }
      button:hover {
        background: var(--ink-hover);
      }
      button:disabled {
        opacity: 0.6;
        cursor: default;
      }
      #error {
        margin: 0;
        min-height: 1.45em;
        font-size: 13px;
        color: var(--error);
      }
    </style>
  </head>
  <body>
    <form id="form">
      <svg viewBox="0 0 22.2 22" fill="currentColor" aria-hidden="true">
        <path d="M0 14.5313C4.12467 14.5313 7.46831 17.8751 7.46831 21.9996H0V14.5313Z" />
        <path
          fill-rule="evenodd"
          clip-rule="evenodd"
          d="M0 7.04705V7.06376C8.2495 7.06387 14.9366 13.7511 14.9366 22H14.9533L14.9366 21.9674C17.9903 21.7842 23.0622 19.7238 21.803 13.1846C20.1335 6.8501 15.1446 1.86298 8.8093 0.195519C2.27485 -1.05826 0.215833 4.01054 0.0331967 7.0632L0 7.04705Z"
        />
      </svg>
      <h1>Parasail Playground Yukun Demo</h1>
      <p>Enter the password you were given to continue.</p>
      <!-- Lets password managers save and fill the password. -->
      <input type="text" name="username" autocomplete="username" value="playground" hidden />
      <input id="password" type="password" name="password" autocomplete="current-password" placeholder="Password" aria-label="Password" required autofocus />
      <button id="submit" type="submit">Continue</button>
      <p id="error" role="alert"></p>
    </form>
    <script>
      var form = document.getElementById('form')
      var password = document.getElementById('password')
      var submit = document.getElementById('submit')
      var error = document.getElementById('error')

      // Back to the page that sent you here, on this site only, with its #fragment (a share link).
      function back() {
        var next = new URL(new URLSearchParams(location.search).get('next') || '/', location.origin)
        return (next.origin === location.origin ? next.pathname + next.search : '/') + location.hash
      }

      form.addEventListener('submit', function (event) {
        event.preventDefault()
        submit.disabled = true
        error.textContent = ''
        fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: password.value }),
        })
          .then(function (res) {
            if (res.ok) return location.replace(back())
            error.textContent = res.status === 401 ? 'That password isn’t right.' : 'Couldn’t sign in (' + res.status + '). Try again.'
          })
          .catch(function () {
            error.textContent = 'Couldn’t reach the playground. Try again.'
          })
          .finally(function () {
            submit.disabled = false
            password.select()
          })
      })
    </script>
  </body>
</html>
`
