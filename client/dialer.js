/* global TelnyxRTC */

const API_BASE = window.location.origin;

let telnyxClient = null;
let activeCall = null;

function setStatus(text, type) {
  const el = document.getElementById('status');
  el.textContent = text;
  el.className = 'status status-' + type;
}

function setButtons(calling) {
  document.getElementById('callBtn').disabled = calling;
  document.getElementById('hangupBtn').disabled = !calling;
}

async function makeCall() {
  const identity = document.getElementById('identity').value.trim();
  const destination = document.getElementById('destination').value.trim();

  if (!identity || !destination) {
    setStatus('Please fill in all fields', 'error');
    return;
  }

  setStatus('Fetching token...', 'calling');
  setButtons(true);

  try {
    const res = await fetch(API_BASE + '/auth/webrtc-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity }),
    });

    if (!res.ok) throw new Error('Failed to get token');
    const data = await res.json();

    telnyxClient = new TelnyxRTC({ login_token: data.token });

    telnyxClient.on('telnyx.ready', function () {
      setStatus('Connected to Telnyx, dialing...', 'calling');
      activeCall = telnyxClient.newCall({
        destinationNumber: destination,
        callerName: identity,
        callerNumber: '',
      });
    });

    telnyxClient.on('telnyx.error', function (error) {
      console.error('Telnyx error:', error);
      setStatus('Error: ' + (error.message || 'Connection failed'), 'error');
      setButtons(false);
    });

    telnyxClient.on('telnyx.notification', function (notification) {
      var call = notification.call;
      if (!call) return;

      switch (call.state) {
        case 'trying':
        case 'requesting':
          setStatus('Calling...', 'calling');
          break;
        case 'recovering':
        case 'ringing':
          setStatus('Ringing...', 'calling');
          break;
        case 'answering':
        case 'active':
          setStatus('Connected', 'connected');
          break;
        case 'hangup':
        case 'destroy':
          setStatus('Call ended', 'ended');
          setButtons(false);
          activeCall = null;
          break;
        default:
          break;
      }
    });

    telnyxClient.connect();
  } catch (err) {
    setStatus('Error: ' + err.message, 'error');
    setButtons(false);
  }
}

function hangUp() {
  if (activeCall) {
    activeCall.hangup();
    activeCall = null;
  }

  if (telnyxClient) {
    telnyxClient.disconnect();
    telnyxClient = null;
  }

  setStatus('Call ended', 'ended');
  setButtons(false);
}
