/**
 * Interactive Setup Widget for OpenRecord.
 *
 * This HTML is served via the MCP Apps ui:// protocol. It provides a
 * user-friendly interface for searching MyChart instances and entering
 * credentials, rather than doing it all in the chat text.
 */

export const SETUP_UI_HTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connect MyChart</title>
  <style>
    :root {
      --bg: #ffffff;
      --text: #1a1a1a;
      --accent: #0066cc;
      --border: #e0e0e0;
      --hover: #f5f5f5;
      --error: #d32f2f;
      --success: #388e3c;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #1e1e1e;
        --text: #e0e0e0;
        --accent: #4da3ff;
        --border: #333333;
        --hover: #2d2d2d;
      }
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      margin: 0;
      padding: 16px;
      line-height: 1.4;
    }
    .container {
      max-width: 400px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    h1 {
      font-size: 18px;
      margin: 0 0 8px 0;
      font-weight: 700;
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    label {
      font-weight: 600;
      font-size: 13px;
      opacity: 0.8;
    }
    input {
      background: var(--bg);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 10px 12px;
      border-radius: 8px;
      font-size: 14px;
      outline: none;
      transition: border-color 0.2s;
    }
    input:focus {
      border-color: var(--accent);
    }
    .actions {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 8px;
    }
    button {
      background: var(--accent);
      color: white;
      border: none;
      padding: 12px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 14px;
      cursor: pointer;
      transition: opacity 0.2s;
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .status {
      font-size: 13px;
      padding: 10px;
      border-radius: 8px;
      display: none;
    }
    .status.error {
      display: block;
      background: rgba(211, 47, 47, 0.1);
      color: var(--error);
      border: 1px solid rgba(211, 47, 47, 0.2);
    }
    .status.success {
      display: block;
      background: rgba(56, 142, 60, 0.1);
      color: var(--success);
      border: 1px solid rgba(56, 142, 60, 0.2);
    }
    .loader {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid rgba(255,255,255,0.3);
      border-radius: 50%;
      border-top-color: #fff;
      animation: spin 1s ease-in-out infinite;
      margin-right: 8px;
      vertical-align: middle;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Connect to MyChart</h1>
    
    <div id="status" class="status"></div>

    <div id="setup-form">
      <div class="field">
        <label>Health System</label>
        <input type="text" id="hostname" placeholder="e.g. mychart.example.org">
      </div>

      <div class="field">
        <label>Username</label>
        <input type="text" id="username" placeholder="Enter your MyChart username">
      </div>

      <div class="field">
        <label>Password</label>
        <input type="password" id="password" placeholder="Enter your MyChart password">
      </div>

      <div id="2fa-section" class="field" style="display: none; margin-top: 8px;">
        <label>Verification Code</label>
        <input type="text" id="2fa-code" placeholder="6-digit code from email/SMS" maxlength="6">
      </div>

      <div class="actions">
        <button id="submit">Connect Account</button>
      </div>
    </div>
  </div>

  <script>
    const hostnameInput = document.getElementById('hostname');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const twoFaSection = document.getElementById('2fa-section');
    const twoFaInput = document.getElementById('2fa-code');
    const submitBtn = document.getElementById('submit');
    const statusDiv = document.getElementById('status');
    const setupForm = document.getElementById('setup-form');
    
    let pendingId = null;

    function showStatus(msg, type = 'error') {
      statusDiv.innerText = msg;
      statusDiv.className = 'status ' + type;
    }

    function hideStatus() {
      statusDiv.style.display = 'none';
    }

    function looksLikeHostname(value) {
      return value.includes('.') || value.includes('://');
    }

    async function resolveHostname(value, callTool) {
      const trimmed = value.trim();
      if (looksLikeHostname(trimmed)) {
        return trimmed.replace(/^https?:\\/\\//, '').replace(/\\/.*$/, '');
      }

      const result = await callTool('search_mycharts', { query: trimmed, limit: 1 });
      const match = result && Array.isArray(result.matches) ? result.matches[0] : null;
      return match ? match.hostname : '';
    }

    submitBtn.onclick = async () => {
      const healthSystem = hostnameInput.value;
      const username = usernameInput.value;
      const password = passwordInput.value;
      const code = twoFaInput.value;

      if (!healthSystem) {
        showStatus('Please enter your health system or MyChart hostname.');
        return;
      }
      if (!username || !password) {
        showStatus('Please enter both username and password.');
        return;
      }

      hideStatus();
      submitBtn.disabled = true;
      const originalText = submitBtn.innerText;
      submitBtn.innerHTML = '<span class="loader"></span> Connecting...';

      try {
        const callTool = async (name, args) => {
          const result = await window.mcp.callTool(name, args);
          if (result && result.content && Array.isArray(result.content)) {
            const textContent = result.content.find(c => c.type === 'text');
            if (textContent) {
              try {
                return JSON.parse(textContent.text);
              } catch (e) {
                return textContent.text;
              }
            }
          }
          return result;
        };

        if (pendingId) {
          // Complete 2FA
          if (!code || code.length < 6) {
            showStatus('Please enter the 6-digit verification code.');
            submitBtn.disabled = false;
            submitBtn.innerText = originalText;
            return;
          }
          const result = await callTool('complete_2fa', { pending_id: pendingId, code });
          if (result.state === 'logged_in') {
            showStatus('Successfully connected! You can now close this widget.', 'success');
            setupForm.style.display = 'none';
          } else if (result.state === 'invalid_2fa') {
            showStatus('Invalid verification code. Please try again.');
            pendingId = result.pending_id; // Update if refreshed
            submitBtn.disabled = false;
            submitBtn.innerText = 'Verify Code';
          } else {
            showStatus('Unexpected state: ' + result.state);
            submitBtn.disabled = false;
            submitBtn.innerText = 'Verify Code';
          }
        } else {
          // Initial Login
          const hostname = await resolveHostname(healthSystem, callTool);
          if (!hostname) {
            showStatus('Could not find that health system. Try entering the MyChart hostname directly.');
            submitBtn.disabled = false;
            submitBtn.innerText = 'Connect Account';
            return;
          }

          const result = await callTool('setup_account', { hostname, username, password });
          
          if (result.state === 'need_2fa') {
            pendingId = result.pending_id;
            twoFaSection.style.display = 'flex';
            showStatus('Verification code sent to your registered device.', 'success');
            submitBtn.disabled = false;
            submitBtn.innerText = 'Verify Code';
          } else if (result.state === 'logged_in') {
            showStatus('Successfully connected! You can now close this widget.', 'success');
            setupForm.style.display = 'none';
          } else if (result.state === 'invalid_login') {
            showStatus('Invalid username or password. Please check your credentials.');
            submitBtn.disabled = false;
            submitBtn.innerText = 'Connect Account';
          } else {
            showStatus(result.message || 'Login failed. Please try again.');
            submitBtn.disabled = false;
            submitBtn.innerText = 'Connect Account';
          }
        }
      } catch (e) {
        showStatus('Error: ' + e.message);
        submitBtn.disabled = false;
        submitBtn.innerText = originalText;
      }
    };
  </script>
</body>
</html>
`;
