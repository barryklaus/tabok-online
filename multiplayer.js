/* TABOK Multiplayer Alpha — host-authoritative PeerJS rooms for static web hosting. */
(() => {
  'use strict';

  const VERSION = 'v0.22.11 Multiplayer Alpha · M12';
  const TOKEN_KEY = 'tabok-multiplayer-token';
  const NAME_KEY = 'tabok-multiplayer-name';
  const NETWORK = window.TABOK_NETWORK || {};
  const DIRECT_ICE_SERVERS = [
    {urls:'stun:stun.cloudflare.com:3478'},
    {urls:'stun:stun.l.google.com:19302'}
  ];
  const token = localStorage.getItem(TOKEN_KEY) || crypto.randomUUID();
  localStorage.setItem(TOKEN_KEY, token);

  const setup = document.getElementById('setupOverlay');
  const dialog = setup.querySelector('.dialog');
  const pill = document.getElementById('networkPill');
  const guide = document.querySelector('.guide');
  const engineStartGame = startGame;
  const engineRenderAll = renderAll;
  const engineShowMessage = showMessage;
  const engineScheduleCPU = scheduleCPU;
  const engineFinishMovement = finishMovement;
  const engineCompleteAction = completeAction;
  const engineFinishPlayerTurn = finishPlayerTurn;
  const engineResolveMonsterPhase = resolveMonsterPhase;
  const engineEndMonsterPhase = endMonsterPhase;

  let peer = null;
  let hostConnection = null;
  let isHost = false;
  let room = null;
  let localDisplayName = localStorage.getItem(NAME_KEY) || '';
  let connections = new Map();
  let connectionTokens = new Map();
  let snapshotTimer = 0;
  let uiTimer = 0;
  let applyingRemote = false;
  let executingRemote = false;
  let suppressSync = false;
  let landingMode = 'home';
  let relayState = NETWORK.turnCredentialEndpoint ? 'idle' : 'direct';
  let relayDetail = NETWORK.turnCredentialEndpoint ? 'Relay fallback configured.' : 'TURN relay endpoint not configured.';
  let iceConfigPromise = null;
  let joinTimeout = 0;
  const nameTimers = new Map();

  const safe = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const cleanName = value => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 18);
  const randomRoom = () => 'tabok-' + Array.from(crypto.getRandomValues(new Uint8Array(4)), n => (n % 36).toString(36)).join('').toUpperCase();
  const roomCode = id => String(id || '').replace(/^tabok-/i, '').toUpperCase();
  const peerIdFromCode = code => /^tabok-/i.test(code) ? code : 'tabok-' + String(code).trim().toUpperCase();
  const setPill = (text, cls = '') => { pill.textContent = text; pill.className = 'network-pill ' + cls; };

  function relayLabel() {
    if (relayState === 'ready') return 'TURN relay ready · restrictive networks supported';
    if (relayState === 'loading') return 'Preparing secure relay fallback…';
    if (relayState === 'failed') return 'TURN relay unavailable · direct connection only';
    if (relayState === 'idle') return 'TURN relay configured · credentials load when connecting';
    return 'Direct connection only · configure turn-relay for cross-network reliability';
  }

  function relayMarkup() {
    const cls = relayState === 'ready' ? 'ready' : relayState === 'failed' || relayState === 'direct' ? 'warning' : 'waiting';
    return '<span class="mp-relay-status '+cls+'" title="'+safe(relayDetail)+'">'+safe(relayLabel())+'</span>';
  }

  function validIceServers(servers) {
    return Array.isArray(servers) && servers.every(server => {
      const urls = Array.isArray(server?.urls) ? server.urls : [server?.urls];
      return urls.some(url => /^(stun|turn|turns):/i.test(String(url || '')));
    });
  }

  async function loadPeerConfig() {
    if (iceConfigPromise) return iceConfigPromise;
    iceConfigPromise = (async () => {
      const endpoint = String(NETWORK.turnCredentialEndpoint || '').trim();
      if (!endpoint) return {iceServers:DIRECT_ICE_SERVERS, sdpSemantics:'unified-plan'};
      relayState = 'loading'; relayDetail = 'Requesting short-lived TURN credentials.';
      setPill('PREPARING RELAY', 'waiting');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(endpoint, {method:'GET', mode:'cors', cache:'no-store', headers:{'Accept':'application/json'}, signal:controller.signal});
        if (!response.ok) throw new Error('credential endpoint returned '+response.status);
        const payload = await response.json();
        if (!validIceServers(payload.iceServers)) throw new Error('credential endpoint returned invalid ICE servers');
        const hasRelay = payload.iceServers.some(server => (Array.isArray(server.urls) ? server.urls : [server.urls]).some(url => /^turns?:/i.test(String(url))));
        if (!hasRelay) throw new Error('credential endpoint returned no TURN routes');
        relayState = 'ready'; relayDetail = 'Short-lived TURN credentials loaded.';
        return {iceServers:payload.iceServers, sdpSemantics:'unified-plan'};
      } catch (error) {
        console.warn('[TABOK relay] Falling back to direct WebRTC:', error);
        relayState = 'failed'; relayDetail = error.name === 'AbortError' ? 'TURN credential request timed out.' : error.message;
        return {iceServers:DIRECT_ICE_SERVERS, sdpSemantics:'unified-plan'};
      } finally {
        clearTimeout(timeout);
      }
    })();
    return iceConfigPromise;
  }

  function engineConfigMarkup() {
    return '<div id="mpEngineConfig" hidden><select id="playerCount"><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option><option selected>6</option></select><input id="monsterLimit" value="3 Monsters"><select id="animationSpeed"><option value="fast" selected>Fast</option><option value="cinematic">Cinematic</option><option value="instant">Instant</option></select><select id="visualQuality"><option value="auto" selected>Auto</option><option value="full">Full</option><option value="lite">Lite</option></select><div id="seatSetup"></div><button id="startGame"></button></div>';
  }

  function renderLanding(message = '') {
    landingMode = 'home';
    setup.classList.remove('hidden');
    dialog.className = 'dialog mp-dialog';
    dialog.innerHTML = '<div class="eyebrow">Cross-platform multiplayer · alpha</div><h2>Gather at the Crossing</h2><p>One browser hosts the expedition. Friends on computers, tablets, or phones join with the room code. No account is required.</p>' +
      '<div class="mp-alert">' + safe(message) + '</div><div class="mp-landing"><button class="mp-choice" id="mpHost"><b>Host a room</b><span>Create the room, choose its size, and start after every Traveler rolls initiative.</span></button><button class="mp-choice" id="mpJoin"><b>Join friends</b><span>Enter the host’s room code, claim a character slot, and rename your Traveler.</span></button></div>' +
      '<p class="mp-room-status">Online rooms require internet access. For the most reliable cross-device play, open this build from an HTTPS website such as GitHub Pages instead of directly from a ZIP.</p>'+relayMarkup() + engineConfigMarkup();
    document.getElementById('mpHost').onclick = () => createRoom();
    document.getElementById('mpJoin').onclick = () => renderJoin();
  }

  function renderJoin(message = '') {
    landingMode = 'join';
    dialog.innerHTML = '<div class="eyebrow">Join a TABOK room</div><h2>Answer the host’s call</h2><div class="mp-alert">' + safe(message) + '</div><div class="mp-join-fields"><label>Your display name<input id="mpJoinName" maxlength="18" value="' + safe(localDisplayName) + '" placeholder="Barry"></label><label>Room code<input id="mpJoinCode" maxlength="16" autocomplete="off" placeholder="AB12CD"></label></div><button class="primary" id="mpConnect">Connect to room</button><button class="mp-back" id="mpBack">Back</button>' + engineConfigMarkup();
    document.getElementById('mpBack').onclick = () => renderLanding();
    document.getElementById('mpConnect').onclick = () => {
      const name = cleanName(document.getElementById('mpJoinName').value);
      const code = document.getElementById('mpJoinCode').value.trim();
      if (!name || !code) return renderJoin('Enter both your name and the room code.');
      localDisplayName = name;
      localStorage.setItem(NAME_KEY, name);
      joinRoom(peerIdFromCode(code));
    };
  }

  function newRoom(id) {
    return {
      id, phase:'lobby', capacity:6, speed:'fast', quality:'auto', hostToken:token, rolling:null,
      seats: PLAYER_DATA.map((data, i) => ({slot:data[0], kind:'open', owner:null, ownerLabel:'', connected:false, charId:CHARACTERS[i].id, customName:CHARACTERS[i].name, roll:null})),
      chat:[{system:true, text:'The room is open. Claim a Traveler or let the host summon CPU companions.'}]
    };
  }

  async function ensurePeer(id, onOpen) {
    if (typeof Peer === 'undefined') {
      renderLanding('The online room service could not load. Check your connection and reload.');
      setPill('NETWORK ERROR', 'error');
      return;
    }
    if (peer) { try { peer.destroy(); } catch (_) {} }
    const config = await loadPeerConfig();
    peer = id ? new Peer(id, {debug:1, config}) : new Peer({debug:1, config});
    peer.on('open', onOpen);
    peer.on('error', error => {
      console.error('[TABOK multiplayer]', error);
      clearTimeout(joinTimeout);
      const text = error.type === 'unavailable-id' ? 'That room code is already in use. Try hosting again.' : error.type === 'peer-unavailable' ? 'That room is not available. Confirm the host is still online and check the room code.' : 'Network error: ' + (error.type || error.message || 'unknown');
      if (room?.phase === 'game') pushSystem(text); else renderLanding(text);
      setPill('NETWORK ERROR', 'error');
    });
    peer.on('disconnected', () => {
      setPill('RECONNECTING', 'waiting');
      if (!peer.destroyed) setTimeout(() => { try { peer.reconnect(); } catch (_) {} }, 900);
    });
  }

  function createRoom() {
    localDisplayName = localDisplayName || 'Host';
    setPill('CREATING ROOM', 'waiting');
    const id = randomRoom();
    ensurePeer(id, openId => {
      isHost = true;
      room = newRoom(openId);
      room.relayHost = relayState === 'ready';
      setPill('HOST · ' + roomCode(openId), 'online');
      peer.on('connection', acceptConnection);
      renderRoom();
      installHostObservers();
    });
  }

  function joinRoom(hostId) {
    setPill('CONNECTING', 'waiting');
    dialog.innerHTML = '<div class="mp-waiting"><h2>Finding the ruins…</h2><p>Connecting to room ' + safe(roomCode(hostId)) + '.</p></div>' + engineConfigMarkup();
    ensurePeer(null, () => {
      isHost = false;
      hostConnection = peer.connect(hostId, {reliable:true, serialization:'json'});
      hostConnection.on('open', () => {
        clearTimeout(joinTimeout);
        setPill('ROOM · ' + roomCode(hostId), 'online');
        hostConnection.send({type:'hello', token, label:localDisplayName, version:VERSION, relay:relayState === 'ready'});
      });
      hostConnection.on('data', receiveFromHost);
      hostConnection.on('close', () => { clearTimeout(joinTimeout); setPill('HOST LOST', 'error'); showRoomNotice('The host disconnected. Your last received board state remains visible.'); });
      hostConnection.on('error', error => { clearTimeout(joinTimeout); setPill('CONNECTION LOST', 'error'); showRoomNotice(error.message || 'Connection failed.'); });
      joinTimeout = setTimeout(() => {
        if (hostConnection?.open) return;
        try { hostConnection?.close(); } catch (_) {}
        setPill('CONNECTION FAILED', 'error');
        renderJoin('The room was found, but no WebRTC path opened. '+(relayState === 'ready' ? 'The TURN relay was available; ask the host to reload the same M4 build.' : 'TURN relay fallback is not available on this deployment.'));
      }, 15000);
    });
  }

  function acceptConnection(conn) {
    conn.on('data', data => receiveFromClient(conn, data));
    conn.on('close', () => {
      const ownerToken = connectionTokens.get(conn.peer);
      connections.delete(ownerToken);
      connectionTokens.delete(conn.peer);
      if (room && ownerToken) {
        const seat = room.seats.find(s => s.owner === ownerToken);
        if (seat) seat.connected = false;
        pushSystem((seat?.customName || 'A Traveler') + ' lost connection. Their slot is reserved for reconnection.');
        broadcastLobby();
      }
    });
  }

  function receiveFromClient(conn, data) {
    if (!data || typeof data !== 'object') return;
    if (data.type === 'hello') {
      connections.set(data.token, conn);
      connectionTokens.set(conn.peer, data.token);
      const seat = room?.seats.find(s => s.owner === data.token);
      if (seat) { seat.connected = true; seat.relayReady = !!data.relay; }
      conn.send({type:'room', room});
      if (room?.phase === 'game' && game) {
        conn.send({type:'game', snapshot:serializeGame()});
        conn.send({type:'ui', ui:captureUI()});
      }
      pushSystem((seat?.customName || cleanName(data.label) || 'A Traveler') + ' connected.');
      broadcastLobby();
      return;
    }
    const sender = connectionTokens.get(conn.peer);
    if (!sender) return;
    if (data.type === 'lobby') handleLobbyAction(sender, data.action, data.payload);
    else if (data.type === 'chat') addChat(sender, data.text);
    else if (data.type === 'command') executeRemoteCommand(sender, data.command);
    else if (data.type === 'input') executeRemoteInput(sender, data.input);
  }

  function receiveFromHost(data) {
    if (!data || typeof data !== 'object') return;
    if (data.type === 'room') {
      room = data.room;
      normalizeRoom();
      if (room.phase === 'lobby') renderRoom(); else { setup.classList.add('hidden'); renderChat(); }
    } else if (data.type === 'game') {
      applyGameSnapshot(data.snapshot);
    } else if (data.type === 'ui') {
      applyUI(data.ui);
    } else if (data.type === 'notice') showRoomNotice(data.text);
  }

  function sendToHost(type, payload) {
    if (isHost) return;
    if (!hostConnection?.open) return showRoomNotice('The host connection is not ready.');
    hostConnection.send({type, ...payload});
  }

  function broadcast(data) {
    if (!isHost) return;
    for (const conn of connections.values()) if (conn.open) conn.send(data);
  }

  function broadcastLobby() {
    if (!room) return;
    if (isHost) broadcast({type:'room', room});
    if (room.phase === 'lobby') renderRoom();
    renderChat();
  }

  function ownSeat(owner = token) { return room?.seats.slice(0, room.capacity).find(s => s.owner === owner); }
  function seatForSlot(slot) { return room?.seats.find(s => s.slot === slot); }
  function ownerConnected(owner) { return owner === token ? true : connections.has(owner); }
  function normalizeRoom() {
    if (!room?.seats) return;
    room.seats.forEach(seat => { if (!seat.kind) seat.kind = seat.owner ? 'human' : 'open'; });
  }
  function occupied(seat) { return seat?.kind === 'human' || seat?.kind === 'cpu'; }
  function charUsed(charId, exceptSlot) { return room.seats.slice(0, room.capacity).some(s => s.slot !== exceptSlot && occupied(s) && s.charId === charId); }
  function giveSeatFreeCharacter(seat) {
    if (!charUsed(seat.charId, seat.slot)) return;
    const available = CHARACTERS.find(character => !charUsed(character.id, seat.slot));
    if (available) seat.charId = available.id;
  }

  function handleLobbyAction(sender, action, payload = {}) {
    if (!isHost || !room || room.phase !== 'lobby') return;
    if (action === 'capacity' && sender === room.hostToken) {
      const next = Math.max(1, Math.min(6, Number(payload.value) || 6));
      if (room.seats.slice(next).some(occupied)) return sendNotice(sender, 'Open occupied higher-numbered slots before reducing the room.');
      room.capacity = next;
      resetInitiative();
    } else if (action === 'settings' && sender === room.hostToken) {
      if (['fast','cinematic','instant'].includes(payload.speed)) room.speed = payload.speed;
      if (['auto','full','lite'].includes(payload.quality)) room.quality = payload.quality;
    } else if (action === 'claim') {
      const seat = seatForSlot(payload.slot);
      if (!seat || room.seats.indexOf(seat) >= room.capacity) return;
      const current = ownSeat(sender);
      if (current && current !== seat) return sendNotice(sender, 'Release your current slot before claiming another.');
      if (seat.kind === 'cpu') return sendNotice(sender, 'The host assigned that slot to a CPU Traveler.');
      if (seat.owner && seat.owner !== sender) return sendNotice(sender, 'That Traveler is already claimed.');
      seat.kind = 'human';
      seat.owner = sender;
      seat.ownerLabel = cleanName(payload.label) || 'Traveler';
      seat.connected = ownerConnected(sender);
      seat.customName = uniqueName(seat.ownerLabel, seat.slot);
      resetInitiative();
      pushSystem(seat.ownerLabel + ' claimed ' + seat.slot + ' as ' + seat.customName + '.');
    } else if (action === 'release') {
      const seat = seatForSlot(payload.slot);
      if (!seat || seat.kind !== 'human' || (seat.owner !== sender && sender !== room.hostToken)) return;
      pushSystem(seat.customName + ' released ' + seat.slot + '.');
      seat.kind = 'open'; seat.owner = null; seat.ownerLabel = ''; seat.connected = false; seat.roll = null;
      resetInitiative();
    } else if (action === 'cpu' && sender === room.hostToken) {
      const seat = seatForSlot(payload.slot);
      if (!seat || room.seats.indexOf(seat) >= room.capacity || seat.kind === 'human') return;
      seat.kind = 'cpu'; seat.owner = null; seat.ownerLabel = 'CPU'; seat.connected = true; seat.roll = null;
      giveSeatFreeCharacter(seat);
      const character = CHARACTERS.find(c => c.id === seat.charId) || CHARACTERS[0];
      seat.customName = uniqueName(character.name, seat.slot);
      resetInitiative();
      pushSystem('The host assigned ' + seat.slot + ' to CPU ' + seat.customName + '.');
    } else if (action === 'open' && sender === room.hostToken) {
      const seat = seatForSlot(payload.slot);
      if (!seat || room.seats.indexOf(seat) >= room.capacity || seat.kind === 'human') return;
      pushSystem('CPU ' + seat.customName + ' left ' + seat.slot + ' open.');
      if (room.rolling === seat.slot) room.rolling = null;
      seat.kind = 'open'; seat.owner = null; seat.ownerLabel = ''; seat.connected = false; seat.roll = null;
      resetInitiative();
    } else if (action === 'fillCPU' && sender === room.hostToken) {
      activeSeats().filter(seat => seat.kind === 'open').forEach(seat => {
        seat.kind = 'cpu'; seat.owner = null; seat.ownerLabel = 'CPU'; seat.connected = true; seat.roll = null;
        giveSeatFreeCharacter(seat);
        const character = CHARACTERS.find(c => c.id === seat.charId) || CHARACTERS[0];
        seat.customName = uniqueName(character.name, seat.slot);
      });
      resetInitiative();
      pushSystem('The host filled every open slot with a CPU Traveler.');
    } else if (action === 'allCPU' && sender === room.hostToken) {
      activeSeats().forEach((seat, index) => {
        const character = CHARACTERS[index] || CHARACTERS[0];
        seat.kind = 'cpu';
        seat.owner = null;
        seat.ownerLabel = 'CPU';
        seat.connected = true;
        seat.roll = null;
        seat.charId = character.id;
        seat.customName = character.name;
      });
      resetInitiative();
      pushSystem('The host prepared an all-CPU spectator expedition.');
    } else if (action === 'name') {
      const seat = seatForSlot(payload.slot);
      const editable = seat && ((seat.kind === 'human' && seat.owner === sender) || (seat.kind === 'cpu' && sender === room.hostToken));
      if (!editable) return;
      const name = cleanName(payload.value);
      if (!name) return sendNotice(sender, 'Traveler names cannot be empty.');
      if (activeSeats().some(s => s !== seat && occupied(s) && s.customName.toLowerCase() === name.toLowerCase())) return sendNotice(sender, 'Every Traveler needs a unique name.');
      seat.customName = name;
      seat.roll = null;
    } else if (action === 'character') {
      const seat = seatForSlot(payload.slot);
      const editable = seat && ((seat.kind === 'human' && seat.owner === sender) || (seat.kind === 'cpu' && sender === room.hostToken));
      if (!editable || !CHARACTERS.some(c => c.id === payload.charId)) return;
      if (charUsed(payload.charId, seat.slot)) return sendNotice(sender, 'That character is already selected.');
      const ch = CHARACTERS.find(c => c.id === payload.charId);
      seat.charId = ch.id;
      if (!seat.customName) seat.customName = ch.name;
      seat.roll = null;
    } else if (action === 'roll') {
      const seat = seatForSlot(payload.slot);
      if (!seat || seat.kind !== 'human' || seat.owner !== sender || seat.roll !== null || room.rolling) return;
      room.rolling = seat.slot;
      broadcastLobby();
      setTimeout(() => {
        if (!room || room.phase !== 'lobby' || room.rolling !== seat.slot || seat.kind !== 'human' || seat.owner !== sender) return;
        const position = drawInitiativePosition();
        if (position === null) { room.rolling = null; broadcastLobby(); return; }
        seat.roll = position;
        room.rolling = null;
        pushSystem(seat.customName + ' locked starting position ' + seat.roll + '.');
        broadcastLobby();
        scheduleCPURolls();
      }, 780);
      return;
    } else if (action === 'start' && sender === room.hostToken) {
      if (!roomReady()) return sendNotice(sender, 'Assign every active slot to a connected Human or CPU and finish initiative.');
      startNetworkGame();
      return;
    }
    broadcastLobby();
    scheduleCPURolls();
  }

  function uniqueName(preferred, slot) {
    const base = cleanName(preferred) || slot;
    if (!activeSeats().some(s => s.slot !== slot && occupied(s) && s.customName.toLowerCase() === base.toLowerCase())) return base;
    let n = 2;
    while (activeSeats().some(s => s.slot !== slot && occupied(s) && s.customName.toLowerCase() === (base + ' ' + n).toLowerCase())) n++;
    return (base + ' ' + n).slice(0, 18);
  }

  function resetInitiative() { room.rolling = null; room.seats.forEach(s => s.roll = null); scheduleCPURolls(); }
  function activeSeats() { return room.seats.slice(0, room.capacity); }
  function occupiedSeats() { return activeSeats().filter(occupied); }
  function humanSeats() { return activeSeats().filter(s => s.kind === 'human'); }
  function availableInitiativePositions() {
    const count = occupiedSeats().length;
    const locked = new Set(occupiedSeats().map(seat => seat.roll).filter(Number.isInteger));
    return Array.from({length:count}, (_, index) => index + 1).filter(position => !locked.has(position));
  }
  function drawInitiativePosition() {
    const available = availableInitiativePositions();
    return available.length ? available[Math.floor(Math.random() * available.length)] : null;
  }
  function scheduleCPURolls() {
    if (!isHost || !room || room.phase !== 'lobby' || room.rolling) return;
    const seat = occupiedSeats().find(candidate => candidate.kind === 'cpu' && candidate.roll === null);
    if (!seat) return;
    room.rolling = seat.slot;
    broadcastLobby();
    setTimeout(() => {
      if (!room || room.phase !== 'lobby' || room.rolling !== seat.slot || seat.kind !== 'cpu') return;
      const position = drawInitiativePosition();
      if (position === null) { room.rolling = null; broadcastLobby(); return; }
      seat.roll = position;
      room.rolling = null;
      pushSystem('CPU ' + seat.customName + ' locked starting position ' + seat.roll + '.');
      broadcastLobby();
      scheduleCPURolls();
    }, 780);
  }
  function roomReady() {
    const seats = activeSeats();
    return seats.length > 0 && seats.every(s => occupied(s) && (s.kind === 'cpu' || s.connected) && Number.isInteger(s.roll) && s.roll >= 1 && s.roll <= seats.length) && new Set(seats.map(s => s.roll)).size === seats.length;
  }

  function renderRoom() {
    if (!room || room.phase !== 'lobby') return;
    landingMode = 'room';
    setup.classList.remove('hidden');
    dialog.className = 'dialog mp-dialog';
    const seats = activeSeats();
    const order = seats.filter(s => occupied(s) && s.roll !== null).slice().sort((a,b) => b.roll-a.roll);
    const availablePositions = availableInitiativePositions();
    dialog.innerHTML = '<div class="eyebrow">Multiplayer lobby · ' + (isHost ? 'you are host' : 'connected guest') + '</div><h2>Choose your Traveler</h2><div class="room-code"><span>Room code</span><b>' + safe(roomCode(room.id)) + '</b><button id="mpCopyCode">Copy code</button></div>'+relayMarkup() +
      '<div class="room-settings"><label>Traveler slots<select id="mpCapacity" ' + (!isHost?'disabled':'') + '>' + [1,2,3,4,5,6].map(n => '<option ' + (room.capacity===n?'selected':'') + '>'+n+'</option>').join('') + '</select></label><label>Animation pace<select id="mpSpeed" ' + (!isHost?'disabled':'') + '><option value="fast" ' + (room.speed==='fast'?'selected':'') + '>Fast</option><option value="cinematic" ' + (room.speed==='cinematic'?'selected':'') + '>Cinematic</option><option value="instant" ' + (room.speed==='instant'?'selected':'') + '>Instant</option></select></label><label>Board quality<select id="mpQuality" ' + (!isHost?'disabled':'') + '><option value="auto" ' + (room.quality==='auto'?'selected':'') + '>Auto</option><option value="full" ' + (room.quality==='full'?'selected':'') + '>High fidelity</option><option value="lite" ' + (room.quality==='lite'?'selected':'') + '>Performance</option></select></label></div>' +
      '<div class="mp-seat-list">' + seats.map(renderLobbySeat).join('') + '</div>' + (isHost ? '<div class="mp-cpu-tools"><button class="mp-fill-cpu" id="mpFillCPU">Fill open slots with CPU</button><button class="mp-all-cpu" id="mpAllCPU">Make every slot CPU</button></div>' : '') + '<div class="mp-room-footer"><div class="mp-room-status">' + (roomReady() ? (humanSeats().length ? '' : 'All-CPU spectator match ready. ') + 'Starting order locked: ' + order.map((s,i) => (i+1)+'. '+safe(s.customName)+' (position '+s.roll+')').join(' · ') : 'Pre-game roll-off: each roll permanently claims one unused position. Available: '+(availablePositions.length?availablePositions.join(', '):'none')+'. Highest position acts first; ties are impossible.') + '</div><button class="primary mp-start" id="mpStart" ' + (!isHost || !roomReady()?'disabled':'') + '>Begin the Crossing</button></div><div class="mp-alert" id="mpLobbyAlert"></div>' + engineConfigMarkup();
    document.getElementById('mpCopyCode').onclick = async () => { try { await navigator.clipboard.writeText(roomCode(room.id)); showLobbyAlert('Room code copied.'); } catch (_) { showLobbyAlert('Room code: ' + roomCode(room.id)); } };
    document.getElementById('mpCapacity').onchange = e => lobbyAction('capacity', {value:e.target.value});
    document.getElementById('mpSpeed').onchange = e => lobbyAction('settings', {speed:e.target.value, quality:room.quality});
    document.getElementById('mpQuality').onchange = e => lobbyAction('settings', {speed:room.speed, quality:e.target.value});
    document.getElementById('mpStart').onclick = () => lobbyAction('start');
    if (isHost) {
      document.getElementById('mpFillCPU').onclick = () => lobbyAction('fillCPU');
      document.getElementById('mpAllCPU').onclick = () => lobbyAction('allCPU');
    }
    dialog.querySelectorAll('[data-claim]').forEach(b => b.onclick = () => lobbyAction('claim', {slot:b.dataset.claim, label:localDisplayName || (isHost?'Host':'Traveler')}));
    dialog.querySelectorAll('[data-release]').forEach(b => b.onclick = () => lobbyAction('release', {slot:b.dataset.release}));
    dialog.querySelectorAll('[data-cpu]').forEach(b => b.onclick = () => lobbyAction('cpu', {slot:b.dataset.cpu}));
    dialog.querySelectorAll('[data-open]').forEach(b => b.onclick = () => lobbyAction('open', {slot:b.dataset.open}));
    dialog.querySelectorAll('[data-roll]').forEach(b => b.onclick = () => lobbyAction('roll', {slot:b.dataset.roll}));
    dialog.querySelectorAll('[data-seat-name]').forEach(input => {
      const commit=()=>{clearTimeout(nameTimers.get(input.dataset.seatName));nameTimers.delete(input.dataset.seatName);lobbyAction('name',{slot:input.dataset.seatName,value:input.value})};
      input.oninput=()=>{clearTimeout(nameTimers.get(input.dataset.seatName));nameTimers.set(input.dataset.seatName,setTimeout(commit,420))};
      input.onchange=commit;
    });
    dialog.querySelectorAll('[data-seat-char]').forEach(select => select.onchange = () => lobbyAction('character', {slot:select.dataset.seatChar, charId:select.value}));
    renderChat();
  }

  function renderLobbySeat(seat) {
    const mine = seat.kind === 'human' && seat.owner === token;
    const cpu = seat.kind === 'cpu';
    const open = seat.kind === 'open';
    const editable = mine || (isHost && cpu);
    const ch = CHARACTERS.find(c => c.id === seat.charId) || CHARACTERS[0];
    const options = CHARACTERS.map(c => '<option value="'+c.id+'" '+(c.id===seat.charId?'selected':'')+' '+(charUsed(c.id,seat.slot)?'disabled':'')+'>'+safe(c.name)+' · '+safe(c.title)+'</option>').join('');
    const action = open ? '<button data-claim="'+seat.slot+'">Claim</button>' + (isHost ? '<button data-cpu="'+seat.slot+'">Add CPU</button>' : '') : cpu ? (isHost ? '<button data-open="'+seat.slot+'">Open slot</button>' : '<small>Host CPU</small>') : (mine || isHost ? '<button data-release="'+seat.slot+'">Release</button>' : '<small>'+(seat.connected?'Connected':'Reconnecting')+'</small>');
    const roll = seat.roll === null ? (cpu ? '<small>'+(room.rolling===seat.slot?'CPU rolling…':'CPU automatic')+'</small>' : mine ? '<button data-roll="'+seat.slot+'" '+(room.rolling?'disabled':'')+'>'+(room.rolling===seat.slot?'Rolling…':'Roll position')+'</button>' : '<small>'+(open?'Unassigned':'Awaiting roll')+'</small>') : '<div class="initiative-die" title="Starting position '+seat.roll+'"><span>'+seat.roll+'</span></div>';
    return '<section class="mp-seat '+(mine?'mine ':'')+(cpu?'cpu ':'')+(open?'unclaimed':'')+'" style="--seat-color:'+ch.color+'"><div class="mp-seat-portrait" style="--portrait-x:'+portraitX(ch.row)+';--portrait-y:'+portraitY(ch.row)+'"></div><div class="mp-seat-main"><strong>'+seat.slot+' · '+safe(cpu?'CPU':seat.ownerLabel || 'Open slot')+'</strong><small>'+(cpu?'host-controlled companion':seat.owner?(seat.connected?'online human':'slot reserved'):'choose or assign this entrance')+'</small><input data-seat-name="'+seat.slot+'" value="'+safe(seat.customName)+'" maxlength="18" '+(!editable?'disabled':'')+' aria-label="Custom Traveler name"><select data-seat-char="'+seat.slot+'" '+(!editable?'disabled':'')+'>'+options+'</select></div><div class="mp-seat-actions">'+action+roll+'</div></section>';
  }

  function lobbyAction(action, payload = {}) {
    if (isHost) handleLobbyAction(token, action, payload);
    else sendToHost('lobby', {action, payload});
  }
  function showLobbyAlert(text) { const host = document.getElementById('mpLobbyAlert'); if (host) host.textContent = text; }
  function sendNotice(owner, text) { if (owner === token) showLobbyAlert(text); else connections.get(owner)?.send({type:'notice', text}); }
  function showRoomNotice(text) { if (room?.phase === 'lobby') showLobbyAlert(text); else { document.getElementById('event').textContent = text; } }
  function pushSystem(text) { if (!room) return; room.chat.push({system:true,text:String(text).slice(0,220),at:Date.now()}); room.chat = room.chat.slice(-80); if (isHost) broadcastLobby(); }

  function installGuideChat() {
    if (!guide || guide.classList.contains('mp-guide')) return;
    guide.classList.add('mp-guide');
    const preview = guide.querySelector('.character-preview');
    const scroll = document.createElement('div');
    scroll.className = 'guide-scroll-body';
    [...guide.children].filter(node => node !== preview).forEach(node => scroll.appendChild(node));
    const chat = document.createElement('section');
    chat.className = 'global-chat'; chat.id = 'globalChat';
    chat.innerHTML = '<div class="chat-head"><b>Global room chat</b><span id="chatRoomLabel">Not connected</span></div><div class="chat-messages" id="chatMessages"></div><form class="chat-form" id="chatForm"><input id="chatInput" maxlength="160" autocomplete="off" placeholder="Message the room…"><button>Send</button></form>';
    guide.replaceChildren(preview, scroll, chat);
    const submitChat=event=>{event.preventDefault();const input=document.getElementById('chatInput'),text=input.value.trim();if(!text)return;input.value='';if(isHost)addChat(token,text);else sendToHost('chat',{text})};
    chat.querySelector('form').onsubmit=submitChat;
    chat.querySelector('button').onclick=submitChat;
  }

  function addChat(sender, text) {
    if (!room) return;
    text = String(text || '').trim().slice(0,160); if (!text) return;
    const seat = ownSeat(sender);
    const name = seat?.customName || (sender === room.hostToken ? 'Host' : 'Guest');
    room.chat.push({name, slot:seat?.slot || '', color:CHARACTERS.find(c=>c.id===seat?.charId)?.color || '#e8c88d', text, at:Date.now()});
    room.chat = room.chat.slice(-80);
    broadcastLobby();
  }

  function renderChat() {
    const host = document.getElementById('chatMessages'), label = document.getElementById('chatRoomLabel');
    if (!host || !label) return;
    label.textContent = room ? roomCode(room.id) : 'Not connected';
    host.replaceChildren(...((room?.chat || []).map(message => {
      const line=document.createElement('div'); line.className='chat-line'+(message.system?' system':'');
      if(message.system) line.textContent=message.text; else { const name=document.createElement('b'); name.textContent=(message.slot?message.slot+' ':'')+message.name; name.style.setProperty('--chat-color',message.color); line.style.setProperty('--chat-color',message.color); line.append(name,document.createTextNode(' '+message.text)); }
      return line;
    })));
    host.scrollTop = host.scrollHeight;
  }

  function prepareEngineInputs() {
    document.getElementById('playerCount').value = String(room.capacity);
    document.getElementById('animationSpeed').value = room.speed;
    document.getElementById('visualQuality').value = room.quality;
    renderSeatSetup();
    activeSeats().forEach((seat,i) => {
      const charSelect = document.querySelectorAll('.character-choice')[i];
      const controlSelect = document.querySelectorAll('.seat-control')[i];
      if (charSelect) charSelect.value = seat.charId;
      if (controlSelect) controlSelect.value = seat.kind === 'cpu' ? 'cpu' : 'human';
    });
  }

  function startNetworkGame() {
    if (!isHost || !roomReady()) return;
    suppressSync = true;
    prepareEngineInputs();
    engineStartGame();
    const seats = activeSeats();
    game.players.forEach((player, i) => {
      const seat = seats[i], ch = CHARACTERS.find(c => c.id === seat.charId);
      player.name = seat.customName;
      player.charId = ch.id; player.title = ch.title; player.color = ch.color; player.spriteRow = ch.row; player.strategy = ch.strategy;
      player.controller = seat.kind === 'cpu' ? 'cpu' : 'human'; player.netOwner = seat.kind === 'human' ? seat.owner : null; player.initiative = seat.roll;
    });
    game.players.sort((a,b) => b.initiative-a.initiative);
    game.current = 0; game.round = 1; game.phase = 'roll'; game.turn = null; game.acted.clear(); game.history = [];
    room.phase = 'game';
    suppressSync = false;
    resetRenderKeys();
    addLog('Initiative order: ' + game.players.map(p => p.name+' ('+p.initiative+')').join(' → ') + '.');
    addLog('Round 1 begins. ' + active().name + ' acts first.');
    setup.classList.add('hidden');
    renderAll();
    broadcast({type:'room', room});
    broadcastGameNow();
    broadcastUI();
    scheduleRuinEvents();
  }

  function serializeGame() {
    return JSON.stringify(game, (_key, value) => value instanceof Map ? {__tabokMap:[...value]} : value instanceof Set ? {__tabokSet:[...value]} : value);
  }
  function deserializeGame(snapshot) {
    return JSON.parse(snapshot, (_key, value) => value && value.__tabokMap ? new Map(value.__tabokMap) : value && value.__tabokSet ? new Set(value.__tabokSet) : value);
  }
  function applyGameSnapshot(snapshot) {
    if (isHost || !snapshot) return;
    applyingRemote = true;
    clearTimeout(cpuTimer); clearTimeout(actionAutoTimer); clearTimeout(ruinEventTimer);
    game = deserializeGame(snapshot);
    resetRenderKeys();
    setup.classList.add('hidden');
    engineRenderAll();
    applyingRemote = false;
    lockRemoteControls();
  }
  function queueSnapshot() {
    if (!isHost || suppressSync || room?.phase !== 'game' || !game) return;
    clearTimeout(snapshotTimer);
    snapshotTimer = setTimeout(broadcastGameNow, 35);
  }
  function broadcastGameNow() { if (isHost && room?.phase === 'game' && game) broadcast({type:'game', snapshot:serializeGame()}); }

  function captureUI() {
    return {
      eye:els.eye.textContent,title:els.title.textContent,instruction:els.instruction.textContent,dice:els.dice.innerHTML,controls:els.controls.innerHTML,event:els.event.textContent,portalState:els.portal.querySelector('.eclipse-well')?.dataset.state||'idle',
      turnRoll:{className:els.turnRoll.className,style:els.turnRoll.getAttribute('style')||'',portraitStyle:els.turnRollPortrait.getAttribute('style')||'',kicker:els.turnRollKicker.textContent,name:els.turnRollName.textContent,role:els.turnRollRole.textContent,status:els.turnRollStatus.textContent,dice:els.turnRollDice.innerHTML,control:els.turnRollControl.innerHTML},
      message:{className:els.message.className,eye:els.messageEye.textContent,title:els.messageTitle.textContent,body:els.messageBody.innerHTML,continueText:els.messageContinue.textContent,continueHidden:els.messageContinue.hidden,input:document.getElementById('lastBreathInput')?.value || ''}
    };
  }
  function applyUI(ui) {
    if (isHost || !ui || !game) return;
    applyingRemote = true;
    els.eye.textContent=ui.eye; els.title.textContent=ui.title; els.instruction.textContent=ui.instruction; els.dice.innerHTML=ui.dice; els.controls.innerHTML=ui.controls; els.event.textContent=ui.event; const portal=els.portal.querySelector('.eclipse-well'); if(portal) portal.dataset.state=ui.portalState||'idle';
    if(ui.turnRoll){els.turnRoll.className=ui.turnRoll.className;els.turnRoll.setAttribute('style',ui.turnRoll.style);els.turnRollPortrait.setAttribute('style',ui.turnRoll.portraitStyle);els.turnRollKicker.textContent=ui.turnRoll.kicker;els.turnRollName.textContent=ui.turnRoll.name;els.turnRollRole.textContent=ui.turnRoll.role;els.turnRollStatus.textContent=ui.turnRoll.status;els.turnRollDice.innerHTML=ui.turnRoll.dice;els.turnRollControl.innerHTML=ui.turnRoll.control}
    els.message.className=ui.message.className; els.messageEye.textContent=ui.message.eye; els.messageTitle.textContent=ui.message.title; els.messageBody.innerHTML=ui.message.body; els.messageContinue.textContent=ui.message.continueText; els.messageContinue.hidden=ui.message.continueHidden;
    const input=document.getElementById('lastBreathInput'); if(input) input.value=ui.message.input;
    applyingRemote=false; lockRemoteControls();
  }
  function queueUI() { if(!isHost||suppressSync||room?.phase!=='game')return; clearTimeout(uiTimer); uiTimer=setTimeout(broadcastUI,80); }
  function broadcastUI() { if(isHost&&room?.phase==='game')broadcast({type:'ui',ui:captureUI()}); }
  function installHostObservers() {
    const observer = new MutationObserver(() => queueUI());
    [els.dice,els.controls,els.instruction,els.event,els.turnRoll,els.message,els.portal].forEach(node => observer.observe(node,{subtree:true,childList:true,attributes:true,characterData:true}));
  }

  function localOwnsSlot(slot) { return seatForSlot(slot)?.owner === token; }
  function localOwnsActive() { return !!(game && active() && localOwnsSlot(active().p)); }
  function challengedSlot() {
    const alert = els.messageBody.querySelector('.challenge-player-alert strong');
    const match = alert?.textContent.match(/\bP[1-6]\b/);
    return match?.[0] || active()?.p;
  }
  function localCanUseMessage(target) {
    const group = target.closest('[data-group-answer]');
    if (group) {
      const seat=activeSeats().find(s=>s.customName===group.dataset.groupAnswer);
      return seat?.owner===token;
    }
    return localOwnsSlot(challengedSlot());
  }
  function lockRemoteControls() {
    if (!room || room.phase !== 'game' || isHost) return;
    const mine = localOwnsActive();
    els.controls.querySelectorAll('button').forEach(button => button.disabled = button.disabled || !mine);
    els.turnRoll.querySelectorAll('button').forEach(button => button.disabled = button.disabled || !mine);
    if (!mine && game.phase !== 'monster' && game.phase !== 'ended') els.instruction.textContent = 'Waiting for ' + active().name + ' on another device…';
  }

  function descriptorFor(target) {
    const playableNode=target.closest('.playable[data-id]'); if(playableNode)return{kind:'board',id:playableNode.dataset.id};
    if(target.closest('.portal-target'))return{kind:'portal'};
    const button=target.closest('button'); if(!button)return null;
    if(button.id)return{kind:'button',id:button.id,scope:button.closest('#messageOverlay')?'message':'game'};
    const dataKeys=['groupAnswer','answerIndex','trivia','replace','runePower','runeTarget','plunderAdd','plunderRemove','plunderBack','plunderConfirm'];
    const data={}; dataKeys.forEach(key=>{if(button.dataset[key]!==undefined)data[key]=button.dataset[key]});
    return{kind:'button',data,aria:button.getAttribute('aria-label')||'',text:button.textContent.trim().replace(/\s+/g,' '),scope:button.closest('#messageOverlay')?'message':'game'};
  }
  function findCommandTarget(command) {
    if(command.kind==='board')return document.querySelector('.playable[data-id="'+cssEscape(command.id)+'"]');
    if(command.kind==='portal')return document.querySelector('.portal-target circle,.portal-target');
    const root=command.scope==='message'?els.message:document;
    if(command.id)return root.querySelector('#'+cssEscape(command.id));
    const entries=Object.entries(command.data||{});
    if(entries.length){const [key,value]=entries[0],attr='data-'+key.replace(/[A-Z]/g,m=>'-'+m.toLowerCase());return root.querySelector('button['+attr+'="'+cssEscape(value)+'"]')}
    const buttons=[...root.querySelectorAll('button')];
    return buttons.find(b=>(command.aria&&b.getAttribute('aria-label')===command.aria)||b.textContent.trim().replace(/\s+/g,' ')===command.text);
  }
  function cssEscape(value) { return window.CSS?.escape ? CSS.escape(String(value)) : String(value).replace(/["\\]/g,'\\$&'); }
  function commandOwner(command) {
    if(command.scope==='message') {
      if(command.data?.groupAnswer){return activeSeats().find(s=>s.customName===command.data.groupAnswer)?.owner}
      return seatForSlot(challengedSlot())?.owner;
    }
    return seatForSlot(active()?.p)?.owner;
  }
  function executeRemoteCommand(sender, command) {
    if(!isHost||room?.phase!=='game'||!command||commandOwner(command)!==sender)return;
    const target=findCommandTarget(command); if(!target||target.disabled)return;
    executingRemote=true;
    if(typeof target.click==='function')target.click();else target.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));
    executingRemote=false; queueUI(); queueSnapshot();
  }
  function executeRemoteInput(sender, input) {
    if(!isHost||room?.phase!=='game'||seatForSlot(challengedSlot())?.owner!==sender)return;
    const node=document.getElementById(input.id); if(!node)return;
    executingRemote=true; node.value=String(input.value||'').slice(0,node.maxLength||200); node.dispatchEvent(new Event('input',{bubbles:true})); executingRemote=false; queueUI();
  }

  document.addEventListener('click', event => {
    if(!room||room.phase!=='game'||executingRemote||event.target.closest('#globalChat'))return;
    const command=descriptorFor(event.target); if(!command)return;
    // Sound is a local device preference, never an authoritative game command.
    if(command.id==='newGame'||command.id==='soundToggle')return;
    const allowed=command.scope==='message'?localCanUseMessage(event.target):localOwnsActive();
    // CPU Travelers have no network owner. Their automatic message clicks used to be
    // rejected here as "unassigned", freezing Portal, Last Breath, and Major Monster
    // scenes. The authoritative host owns CPU-only message resolution and may also
    // tap Continue manually if a mobile browser throttles an automatic timer.
    const hostOwnsCPUMessage=isHost&&command.scope==='message'&&active()?.controller==='cpu';
    if(isHost){if(!allowed&&!hostOwnsCPUMessage){event.preventDefault();event.stopImmediatePropagation();showRoomNotice('Waiting for the assigned Traveler on their device.')}}
    else{event.preventDefault();event.stopImmediatePropagation();if(allowed)sendToHost('command',{command});else showRoomNotice('It is not your Traveler’s decision.');}
  },true);
  document.addEventListener('input', event => {
    if(isHost||!room||room.phase!=='game'||event.target.id!=='lastBreathInput'||applyingRemote)return;
    event.stopImmediatePropagation();
    if(localCanUseMessage(event.target))sendToHost('input',{input:{id:event.target.id,value:event.target.value}});
  },true);

  renderAll = function(){ engineRenderAll(); queueSnapshot(); queueUI(); if(!isHost)lockRemoteControls(); };
  showMessage = function(...args){ const value=engineShowMessage(...args); queueUI(); return value; };
  scheduleCPU = function(){ if(isHost||!room||room.phase!=='game')return engineScheduleCPU(); };
  finishMovement = function(...args){ if(isHost||!room||room.phase!=='game')return engineFinishMovement(...args); };
  completeAction = function(...args){ if(isHost||!room||room.phase!=='game')return engineCompleteAction(...args); };
  finishPlayerTurn = function(...args){ if(isHost||!room||room.phase!=='game')return engineFinishPlayerTurn(...args); };
  resolveMonsterPhase = function(...args){ if(isHost||!room||room.phase!=='game')return engineResolveMonsterPhase(...args); };
  endMonsterPhase = function(...args){ if(isHost||!room||room.phase!=='game')return engineEndMonsterPhase(...args); };

  document.getElementById('newGame').onclick = () => {
    if(!room)return renderLanding();
    if(room.phase==='game'&&isHost){
      if(!confirm('Return every connected player to the lobby and abandon this expedition?'))return;
      clearTimeout(cpuTimer);clearTimeout(portalRevealTimer);clearTimeout(actionAutoTimer);clearTimeout(ruinEventTimer);busy=false;game=null;room.phase='lobby';room.seats.forEach(s=>s.roll=null);broadcastLobby();renderRoom();scheduleCPURolls();pauseAmbient(true);
    }else if(room.phase==='game'){showRoomNotice('Only the host can reset the expedition.');}
    else renderRoom();
  };

  installGuideChat();
  renderChat();
  renderLanding();
  setPill('MULTIPLAYER READY','waiting');
  window.TabokMultiplayer={get room(){return room},get isHost(){return isHost},version:VERSION};
})();
