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
    .autocomplete-container {
      position: relative;
    }
    .dropdown {
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      right: 0;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      max-height: 240px;
      overflow-y: auto;
      z-index: 100;
      display: none;
      box-shadow: 0 8px 24px rgba(0,0,0,0.15);
    }
    .dropdown.show {
      display: block;
    }
    .item {
      padding: 10px 12px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 12px;
      border-bottom: 1px solid var(--border);
    }
    .item:last-child {
      border-bottom: none;
    }
    .item:hover {
      background: var(--hover);
    }
    .item img {
      width: 32px;
      height: 32px;
      border-radius: 6px;
      object-fit: contain;
      background: white;
      padding: 2px;
      border: 1px solid var(--border);
    }
    .item .placeholder-logo {
      width: 32px;
      height: 32px;
      border-radius: 6px;
      background: var(--border);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      font-size: 14px;
      color: var(--text);
      opacity: 0.5;
    }
    .item .info {
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .item .name {
      font-weight: 600;
      font-size: 14px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .item .hostname {
      font-size: 11px;
      opacity: 0.6;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
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
        <div class="autocomplete-container">
          <input type="text" id="system-search" placeholder="Search (e.g. UCHealth, Mass General)..." autocomplete="off">
          <div id="dropdown" class="dropdown"></div>
        </div>
        <input type="hidden" id="hostname">
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
    const searchInput = document.getElementById('system-search');
    const dropdown = document.getElementById('dropdown');
    const hostnameInput = document.getElementById('hostname');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const twoFaSection = document.getElementById('2fa-section');
    const twoFaInput = document.getElementById('2fa-code');
    const submitBtn = document.getElementById('submit');
    const statusDiv = document.getElementById('status');
    const setupForm = document.getElementById('setup-form');
    
    let instances = [];
    let pendingId = null;

    async function init() {
      try {
        // Fetch full instance list from MCP resource
        const response = await fetch('resource://openrecord/instances');
        if (response.ok) {
          instances = await response.json();
        }
      } catch (e) {
        console.error('Failed to load instances', e);
      }
    }

    function showStatus(msg, type = 'error') {
      statusDiv.innerText = msg;
      statusDiv.className = 'status ' + type;
    }

    function hideStatus() {
      statusDiv.style.display = 'none';
    }

    searchInput.addEventListener('input', () => {
      const query = searchInput.value.toLowerCase().trim();
      hideStatus();
      if (query.length < 2) {
        dropdown.classList.remove('show');
        return;
      }

      const matches = instances.filter(i => 
        i.name.toLowerCase().includes(query) || 
        i.hostname.toLowerCase().includes(query)
      ).slice(0, 8);

      dropdown.innerHTML = '';
      matches.forEach(m => {
        const div = document.createElement('div');
        div.className = 'item';
        const logoHtml = m.logoUrl 
          ? \`<img src="\${m.logoUrl}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'">\`
          : '';
        const placeholderHtml = \`<div class="placeholder-logo" \${m.logoUrl ? 'style="display:none"' : ''}>\${m.name[0]}</div>\`;
        
        div.innerHTML = \`
          \${logoHtml}
          \${placeholderHtml}
          <div class="info">
            <span class="name">\${m.name}</span>
            <span class="hostname">\${m.hostname}</span>
          </div>
        \`;
        div.onclick = () => {
          searchInput.value = m.name;
          hostnameInput.value = m.hostname;
          dropdown.classList.remove('show');
        };
        dropdown.appendChild(div);
      });

      if (matches.length > 0) {
        dropdown.classList.add('show');
      } else {
        dropdown.classList.remove('show');
      }
    });

    document.addEventListener('click', (e) => {
      if (!searchInput.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.classList.remove('show');
      }
    });

    submitBtn.onclick = async () => {
      const hostname = hostnameInput.value;
      const username = usernameInput.value;
      const password = passwordInput.value;
      const code = twoFaInput.value;

      if (!hostname) {
        showStatus('Please select a health system from the list.');
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
        if (pendingId) {
          // Complete 2FA
          if (!code || code.length < 6) {
            showStatus('Please enter the 6-digit verification code.');
            submitBtn.disabled = false;
            submitBtn.innerText = originalText;
            return;
          }
          const result = await window.mcp.callTool('complete_2fa', { pending_id: pendingId, code });
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
          const result = await window.mcp.callTool('setup_account', { hostname, username, password });
          
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

    init();
  </script>
</body>
</html>
`;
