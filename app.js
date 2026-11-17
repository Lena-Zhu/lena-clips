/* Lena学英语 · 每日片段 —— 只播放和展示，不记录任何东西 */
(function () {
  'use strict';

  var app = document.getElementById('app');
  var indexCache = null;
  var view = null; // 当前片段页的状态；首页时为 null

  // ---------- 小工具 ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(v) { var n = Number(v); return isFinite(n) ? n : null; }
  function fmt(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function getJSON(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(r.status + ' ' + url);
      return r.json();
    });
  }
  function store(key, val) {
    try {
      if (val === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, val);
    } catch (e) {}
    return null;
  }

  // ---------- 主题 ----------
  var THEMES = ['cream', 'light', 'dark'];
  var THEME_NAME = { cream: '护眼', light: '浅色', dark: '深色' };
  var themeBtn = document.getElementById('themeBtn');
  function curTheme() {
    var t = document.documentElement.getAttribute('data-theme');
    return THEMES.indexOf(t) >= 0 ? t : 'cream';
  }
  function paintThemeBtn() { themeBtn.textContent = '主题：' + THEME_NAME[curTheme()]; }
  themeBtn.addEventListener('click', function () {
    var next = THEMES[(THEMES.indexOf(curTheme()) + 1) % THEMES.length];
    document.documentElement.setAttribute('data-theme', next);
    store('clips-theme', next);
    paintThemeBtn();
  });
  paintThemeBtn();

  // ---------- 路由 ----------
  function route() {
    teardown();
    var m = /^#\/c\/([^/?#]+)/.exec(location.hash);
    if (m) {
      var id;
      try { id = decodeURIComponent(m[1]); } catch (e) { id = m[1]; }
      showClip(id);
    } else {
      showHome();
    }
  }
  window.addEventListener('hashchange', route);

  function loadIndex() {
    if (indexCache) return Promise.resolve(indexCache);
    return getJSON('clips/index.json').then(function (d) {
      var list = (d && Array.isArray(d.clips)) ? d.clips.filter(function (c) { return c && c.id; }) : [];
      list.sort(function (a, b) {
        return (num(b.day) || 0) - (num(a.day) || 0) || String(b.date || '').localeCompare(String(a.date || ''));
      });
      indexCache = list;
      return list;
    });
  }

  function tagsHTML(c) {
    var h = '';
    if (c.topic) h += '<span class="tag topic">' + esc(c.topic) + '</span>';
    if (c.structure) h += '<span class="tag struct">' + esc(c.structure) + '</span>';
    return h;
  }
  function srcLine(c) {
    return [c.show, c.guest].filter(Boolean).map(esc).join(' · ');
  }
  function dayLabel(c) {
    var d = num(c.day);
    if (d === null) return '';
    return d === 0 ? '样例' : 'Day ' + d;
  }

  // ---------- 首页 ----------
  function showHome() {
    document.title = 'Lena学英语 · 每日片段';
    app.innerHTML = '<p class="hint">加载中…</p>';
    loadIndex().then(function (list) {
      if (view || /^#\/c\//.test(location.hash)) return;
      if (!list.length) { app.innerHTML = '<p class="hint">还没有片段。</p>'; return; }
      var h = '<div class="home"><p class="home-lede">每天一段 3–8 分钟的访谈精华：先盲听，再对照，最后跟读。</p>';
      var lastKey = null;
      list.forEach(function (c) {
        var key = String(c.day) + '|' + String(c.date || '');
        if (key !== lastKey) {
          lastKey = key;
          h += '<div class="day-h"><b>' + esc(dayLabel(c) || '片段') + '</b><span>' + esc(c.date || '') + '</span></div>';
        }
        var dur = (num(c.end) !== null && num(c.start) !== null) ? fmt(c.end - c.start) : '';
        h += '<a class="card" href="#/c/' + encodeURIComponent(c.id) + '">' +
          '<div class="card-src">' + srcLine(c) + '</div>' +
          '<div class="card-title">' + esc(c.title_zh || c.id) + '</div>' +
          '<div class="tags">' + tagsHTML(c) + (dur ? '<span class="dur">' + dur + '</span>' : '') + '</div></a>';
      });
      app.innerHTML = h + '</div>';
      window.scrollTo(0, 0);
    }).catch(function () {
      app.innerHTML = '<p class="hint">片段列表加载失败，刷新再试一次。</p>';
    });
  }

  // ---------- YouTube IFrame API ----------
  var ytPromise = null;
  function loadYT() {
    if (ytPromise) return ytPromise;
    ytPromise = new Promise(function (resolve, reject) {
      if (window.YT && window.YT.Player) return resolve(window.YT);
      var prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () { if (prev) prev(); resolve(window.YT); };
      var s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.onerror = function () { ytPromise = null; reject(new Error('yt')); };
      document.head.appendChild(s);
    });
    return ytPromise;
  }

  function teardown() {
    if (!view) return;
    clearInterval(view.timer);
    try { if (view.player && view.player.destroy) view.player.destroy(); } catch (e) {}
    view.dead = true;
    view = null;
    document.body.classList.remove('hide-en', 'hide-zh');
  }

  // ---------- 片段页 ----------
  function showClip(id) {
    app.innerHTML = '<p class="hint">加载中…</p>';
    var v = view = { id: id, dead: false, cur: -1, loop: false, loopIdx: -1, rate: 1, ready: false, atEnd: false, timer: 0 };
    Promise.all([
      getJSON('clips/' + encodeURIComponent(id) + '.json'),
      loadIndex().catch(function () { return []; })
    ]).then(function (res) {
      if (v.dead) return;
      renderClip(v, res[0] || {}, res[1]);
    }).catch(function () {
      if (v.dead) return;
      app.innerHTML = '<p class="hint">没找到这个片段（' + esc(id) + '）。<a href="#/">回到列表</a></p>';
    });
  }

  function hlHTML(en, hl) {
    // 把 hl 里的原文片段包成可点的高亮；找不到的片段直接跳过
    var spans = [];
    (Array.isArray(hl) ? hl : []).forEach(function (h, k) {
      if (!h || !h.text) return;
      var from = 0, at;
      while ((at = en.indexOf(h.text, from)) >= 0) {
        var end = at + h.text.length;
        var clash = spans.some(function (s) { return at < s.b && end > s.a; });
        if (!clash) { spans.push({ a: at, b: end, k: k }); break; }
        from = at + 1;
      }
    });
    spans.sort(function (x, y) { return x.a - y.a; });
    var out = '', pos = 0;
    spans.forEach(function (s) {
      out += esc(en.slice(pos, s.a));
      var note = hl[s.k].note || '';
      out += '<span class="hl" data-k="' + s.k + '"' + (note ? ' title="' + esc(note) + '"' : '') + '>' + esc(en.slice(s.a, s.b)) + '</span>';
      pos = s.b;
    });
    return out + esc(en.slice(pos));
  }

  function renderClip(v, clip, list) {
    var sents = (Array.isArray(clip.sents) ? clip.sents : []).filter(function (s) { return s && num(s.s) !== null; })
      .slice().sort(function (a, b) { return a.s - b.s; });
    var start = num(clip.start); if (start === null) start = sents.length ? sents[0].s : 0;
    var end = num(clip.end);
    if (end === null) end = sents.length ? (num(sents[sents.length - 1].e) || sents[sents.length - 1].s + 8) : start + 300;
    // 每句的结束时间：自带 e → 下一句开头 → 片段结尾
    sents.forEach(function (s, n) {
      var e = num(s.e);
      if (e === null || e <= s.s) e = n + 1 < sents.length ? sents[n + 1].s : end;
      s._e = e;
    });
    var byI = {};
    sents.forEach(function (s, n) { byI[String(s.i != null ? s.i : n)] = n; });
    v.clip = clip; v.sents = sents; v.start = start; v.end = end; v.byI = byI;

    document.title = (clip.title_zh || clip.id || '片段') + ' · 每日片段';
    var ytUrl = clip.youtube ? 'https://www.youtube.com/watch?v=' + encodeURIComponent(clip.youtube) + '&t=' + Math.floor(start) + 's' : '';

    var h = '<article class="clip">';
    h += '<header class="clip-head"><a class="back" href="#/">← 全部片段</a>' +
      '<h1>' + esc(clip.title_zh || clip.id || '') + '</h1>' +
      '<div class="clip-sub">' + [dayLabel(clip), clip.date, clip.show, clip.guest].filter(Boolean).map(esc).join(' · ') +
      ' · ' + fmt(end - start) + '</div>' +
      '<div class="tags">' + tagsHTML(clip) + '</div></header>';

    h += '<div class="stage"><div class="video"><div id="yt"></div><div class="cap" hidden></div></div>' +
      '<div class="bar">' +
      '<button class="btn" type="button" data-act="back">退3秒</button>' +
      '<button class="btn" type="button" data-act="prev">上一句</button>' +
      '<button class="btn play" type="button" data-act="play">播放</button>' +
      '<button class="btn" type="button" data-act="next">下一句</button>' +
      '<button class="btn" type="button" data-act="fwd">进3秒</button>' +
      '<button class="btn" type="button" data-act="again">重听这句</button>' +
      '<button class="btn" type="button" data-act="stop1" aria-pressed="false">一句一停</button>' +
      '<button class="btn" type="button" data-act="loop" aria-pressed="false">单句循环</button>' +
      '<button class="btn" type="button" data-act="rate">速度 1×</button>' +
      '</div>' +
      '<div class="status"><span id="st"></span><button class="mini" type="button" data-act="zh" aria-pressed="true">中文</button><button class="mini" type="button" data-act="en" aria-pressed="true">英文</button><button class="mini" type="button" data-act="replay">从头播</button>' + (ytUrl ? '<a href="' + esc(ytUrl) + '" target="_blank" rel="noopener">在 YouTube 打开</a>' : '') + '</div></div>';

    h += '<div class="body">';
    if (clip.intro_zh) h += '<div class="intro">' + esc(clip.intro_zh) + '</div>';

    if (sents.length) {
      h += '<div class="cues" id="cues">';
      sents.forEach(function (s, n) {
        var host = clip.guest && s.spk && s.spk !== clip.guest;
        h += '<div class="cue" data-n="' + n + '" role="button" tabindex="0">' +
          '<div class="cue-meta"><span class="ts">' + fmt(s.s - start) + '</span>' +
          (s.spk ? '<span class="who' + (host ? ' host' : '') + '">' + esc(s.spk) + '</span>' : '') + '</div>' +
          (s.en ? '<div class="en" lang="en">' + hlHTML(String(s.en), s.hl) + '</div>' : '') +
          (s.zh ? '<div class="zh">' + esc(s.zh) + '</div>' : '') + '</div>';
      });
      h += '</div>';
    } else {
      h += '<p class="hint">这个片段还没有逐句文本。</p>';
    }

    var shadow = (Array.isArray(clip.shadow) ? clip.shadow : []).filter(function (x) { return x && byI[String(x.i)] != null; });
    if (shadow.length) {
      h += '<h2 class="sec-h">影子跟读</h2><p class="sec-note">点一句：跳过去并打开单句循环，跟着说到顺口为止。</p>';
      shadow.forEach(function (x) {
        var s = sents[byI[String(x.i)]];
        h += '<button class="shadow-item" type="button" data-shadow="' + byI[String(x.i)] + '">' +
          '<div class="en" lang="en">' + esc(s.en || '') + '</div>' +
          (s.zh ? '<div class="zh">' + esc(s.zh) + '</div>' : '') +
          (x.tips ? '<div class="tips">' + esc(x.tips) + '</div>' : '') +
          '<div class="go">▶ 循环这句</div></button>';
      });
    }

    var qs = (Array.isArray(clip.questions) ? clip.questions : []).filter(Boolean);
    if (qs.length) {
      h += '<h2 class="sec-h">语音聊天提问池<button class="btn" type="button" data-act="copy">复制</button></h2>' +
        '<p class="sec-note">复制后贴给语音聊天，让它拿这些问题问你。</p><ol class="qs" lang="en">';
      qs.forEach(function (q) { h += '<li>' + esc(q) + '</li>'; });
      h += '</ol>';
    }

    var chunks = (Array.isArray(clip.chunks) ? clip.chunks : []).filter(function (c) { return c && c.en; });
    if (chunks.length) {
      h += '<h2 class="sec-h">本段 chunks</h2><div class="chunks">';
      chunks.forEach(function (c) {
        var n = byI[String(c.i)];
        var inner = '<div class="en" lang="en">' + esc(c.en) + '</div>' + (c.zh ? '<div class="zh">' + esc(c.zh) + '</div>' : '');
        h += n != null ? '<button class="chunk" type="button" data-chunk="' + n + '" title="跳到原句">' + inner + '</button>'
          : '<div class="chunk">' + inner + '</div>';
      });
      h += '</div>';
    }

    // 上一天 / 下一天
    var pos = -1;
    (list || []).forEach(function (c, k) { if (c.id === v.id) pos = k; });
    if (pos >= 0 && list.length > 1) {
      var newer = list[pos - 1], older = list[pos + 1];
      h += '<nav class="foot">' +
        (older ? '<a class="btn" href="#/c/' + encodeURIComponent(older.id) + '">← ' + esc(dayLabel(older) || '上一段') + '</a>' : '') +
        (newer ? '<a class="btn" href="#/c/' + encodeURIComponent(newer.id) + '">' + esc(dayLabel(newer) || '下一段') + ' →</a>' : '') +
        '</nav>';
    }
    h += '</div></article>';
    app.innerHTML = h;
    window.scrollTo(0, 0);

    v.cueEls = app.querySelectorAll('.cue');
    v.stEl = document.getElementById('st');
    v.stage = app.querySelector('.stage');
    v.box = app.querySelector('.video');
    bindClip(v);
    try { if (localStorage.getItem('clips:stop1') === '1') setStop1(v, true); } catch (e) {}
    paintStatus(v);

    if (!clip.youtube) { videoMsg(v, '这个片段没有视频地址。'); return; }
    loadYT().then(function (YT) {
      if (v.dead) return;
      v.player = new YT.Player('yt', {
        videoId: clip.youtube,
        width: '100%', height: '100%',
        playerVars: { start: Math.floor(start), playsinline: 1, rel: 0, modestbranding: 1, controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3, origin: location.origin },
        events: {
          onReady: function () {
            if (v.dead) return;
            v.ready = true;
            v.timer = setInterval(function () { tick(v); }, 100);
            if (v.pending != null) { var p = v.pending; v.pending = null; seek(v, p, true); }
          },
          onStateChange: function (e) { onState(v, e.data); },
          onError: function () {
            videoMsg(v, '视频在这里放不出来。' + (ytUrl ? '<a href="' + esc(ytUrl) + '" target="_blank" rel="noopener">去 YouTube 看这一段</a>' : ''));
          }
        }
      });
    }).catch(function () {
      if (!v.dead) videoMsg(v, 'YouTube 播放器加载失败，检查网络后刷新。');
    });
  }

  function videoMsg(v, html) {
    var box = app.querySelector('.video');
    if (!box || v.dead) return;
    var d = document.createElement('div');
    d.className = 'video-msg';
    d.innerHTML = html;
    box.appendChild(d);
  }

  // ---------- 播放控制 ----------
  function playing(v) {
    try { return v.ready && v.player.getPlayerState() === 1; } catch (e) { return false; }
  }
  // 广告期间播放器报的时长是广告的时长，比片段结束点还短
  function inAd(v) {
    try {
      var d = v.player.getDuration();
      if (d > 0 && d < v.end - 1) return true;
      var vd = v.player.getVideoData && v.player.getVideoData();
      return !!(vd && vd.video_id && vd.video_id !== v.clip.youtube);
    } catch (e) { return false; }
  }
  function now(v) {
    try { return v.ready ? v.player.getCurrentTime() : v.start; } catch (e) { return v.start; }
  }
  function seek(v, t, play) {
    v.atEnd = false;
    if (!v.ready) { v.pending = t; v.tried = Date.now(); paintStatus(v); return; }
    try {
      v.player.seekTo(t, true);
      if (play) { v.player.playVideo(); v.tried = Date.now(); }
    } catch (e) {}
  }
  function nudge(v, d) {
    if (!v.ready) return;
    var t = Math.min(v.end - 0.2, Math.max(v.start, now(v) + d));
    if (v.loop) setLoop(v, false);
    v.seg = null;
    v.hold = Date.now();
    var n = findSent(v, t);
    if (n !== v.cur) setCur(v, n, 'auto');
    seek(v, t, true);
  }
  function again(v) {
    var n = v.loop ? v.loopIdx : v.cur;
    if (n < 0) n = 0;
    if (!v.sents[n]) return;
    v.seg = n;
    v.hold = Date.now();
    seek(v, v.sents[n].s, true);
  }
  function goSent(v, n, scroll) {
    if (!v.sents.length) return;
    n = Math.max(0, Math.min(v.sents.length - 1, n));
    if (v.loop) v.loopIdx = n;
    setCur(v, n, scroll ? 'force' : 'none');
    v.seg = n;
    v.hold = Date.now(); // 刚跳转时播放器回报的还是旧时间，先别让 tick 改回去
    seek(v, v.sents[n].s, true);
  }
  // 一句一停：这一句放完自动暂停；再按播放（或空格）接着放下一句
  function setStop1(v, on) {
    v.stop1 = on;
    v.seg = null;
    if (on && v.loop) setLoop(v, false);
    var b = app.querySelector('[data-act="stop1"]');
    if (b) b.setAttribute('aria-pressed', on ? 'true' : 'false');
    try { localStorage.setItem('clips:stop1', on ? '1' : '0'); } catch (e) {}
  }
  function setLoop(v, on) {
    if (on && v.stop1) setStop1(v, false);
    v.loop = on;
    v.loopIdx = on ? Math.max(0, v.cur) : -1;
    var b = app.querySelector('[data-act="loop"]');
    if (b) b.setAttribute('aria-pressed', on ? 'true' : 'false');
    paintLoop(v);
    paintStatus(v);
  }
  function paintLoop(v) {
    for (var k = 0; k < v.cueEls.length; k++) v.cueEls[k].classList.toggle('looping', v.loop && k === v.loopIdx);
  }
  function paintStatus(v) {
    if (!v.stEl) return;
    var t = '';
    if (v.sents.length) t = (v.cur >= 0 ? '第 ' + (v.cur + 1) + ' / ' + v.sents.length + ' 句' : '共 ' + v.sents.length + ' 句');
    if (v.loop) t += ' · 循环中';
    if (v.needTap) t = '先点一下视频上的播放键';
    v.stEl.textContent = t;
  }

  function setCur(v, n, scroll) {
    if (n === v.cur && scroll !== 'force') return;
    var prevEl = v.cur >= 0 ? v.cueEls[v.cur] : null;
    var el = n >= 0 ? v.cueEls[n] : null;
    var top = stageBottom(v);
    // 只有上一句还在视野里（说明她正跟着看）才自动滚动，免得把她从下面的板块拽回来
    var follow = scroll === 'force' || (scroll !== 'none' && (!prevEl || inView(prevEl, top)));
    if (prevEl) prevEl.classList.remove('now');
    if (el) el.classList.add('now');
    v.cur = n;
    paintLoop(v);
    paintStatus(v);
    if (el && follow) {
      var r = el.getBoundingClientRect();
      var lo = top + 12, hi = window.innerHeight * 0.72;
      if (r.top < lo || r.bottom > hi) {
        var smooth = !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
        window.scrollTo({ top: window.scrollY + r.top - lo - 40, behavior: smooth ? 'smooth' : 'auto' });
      }
    }
  }
  function stageBottom(v) {
    if (!v.stage || (window.matchMedia && window.matchMedia('(min-width: 960px)').matches)) return 0;
    return Math.max(0, v.stage.getBoundingClientRect().bottom);
  }
  function inView(el, top) {
    var r = el.getBoundingClientRect();
    return r.bottom > top && r.top < window.innerHeight;
  }
  function findSent(v, t) {
    var a = v.sents, lo = 0, hi = a.length - 1, ans = -1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (a[mid].s <= t + 0.05) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }

  function tick(v) {
    if (v.dead || !v.ready) return;
    var ad = inAd(v);
    if (ad) return;
    var t = now(v), isPlaying = playing(v);
    if (v.loop && v.loopIdx >= 0) {
      var s = v.sents[v.loopIdx];
      if (isPlaying && (t >= s._e - 0.04 || t < s.s - 0.6)) seek(v, s.s, true);
      if (v.cur !== v.loopIdx) setCur(v, v.loopIdx, 'auto');
      return;
    }
    if (isPlaying && t >= v.end) {
      try { v.player.pauseVideo(); } catch (e) {}
      v.atEnd = true;
      return;
    }
    if (v.hold && Date.now() - v.hold < 700) return;
    if (v.stop1 && isPlaying && t >= v.start - 0.5) {
      if (v.seg == null) v.seg = Math.max(0, findSent(v, t + 0.15));
      var g = v.sents[v.seg];
      if (g && (t >= g._e - 0.05 || t < g.s - 0.6)) {
        if (t < g.s - 0.6) { v.seg = null; }
        else {
          try { v.player.pauseVideo(); } catch (e) {}
          if (v.cur !== v.seg) setCur(v, v.seg, 'auto');
          v.seg = null;
          return;
        }
      }
    } else if (!isPlaying && !v.stop1) v.seg = null;
    if (isPlaying || v.cur < 0) {
      var n = t < v.start - 0.5 ? -1 : findSent(v, t);
      if (n !== v.cur && (isPlaying || n > 0)) setCur(v, n, 'auto');
    }
  }

  function onState(v, st) {
    if (v.dead) return;
    var b = app.querySelector('.btn[data-act="play"]');
    if (b) b.textContent = st === 1 || st === 3 ? '暂停' : '播放';
    // 暂停时 YouTube 会在画面上盖标题、推荐视频和标志，去不掉。
    // 办法：暂停期间把播放器拉高、只露中间的画面，那些东西落在看不见的上下两段；自己补一行当前句的字幕。
    if (st === 1 || st === 2) {
      var crop = st === 2 && v.started && !inAd(v);
      if (v.box) v.box.classList.toggle('crop', crop);
      var cap = app.querySelector('.cap');
      if (cap) {
        var cs = crop && v.sents[v.loop ? v.loopIdx : v.cur];
        cap.hidden = !cs;
        if (cs) cap.textContent = cs.en || '';
      }
    }
    if (st === 1) {
      if (inAd(v)) return;
      v.started = true; // 广告在放：别跳转，等它放完或她点跳过
      if (v.needTap) { v.needTap = false; paintStatus(v); }
      try { if (v.player.getPlaybackRate() !== v.rate) v.player.setPlaybackRate(v.rate); } catch (e) {}
      var t = now(v);
      // 播到片段结尾后再按播放、或者起点被取整到前一秒：回到片段开头
      if ((v.atEnd && t >= v.end - 0.3) || t >= v.end + 0.5 || t < v.start - 0.3) {
        if (!(v.loop && v.loopIdx >= 0)) seek(v, v.start, true);
      }
      v.atEnd = false;
    }
  }

  function togglePlay(v) {
    if (!v.ready) { v.pending = v.cur >= 0 ? v.sents[v.cur].s : v.start; return; }
    if (playing(v)) { try { v.player.pauseVideo(); } catch (e) {} return; }
    if (v.atEnd) { seek(v, v.start, true); return; }
    try { v.player.playVideo(); v.tried = Date.now(); } catch (e) {}
    // 手机上第一次播放有时必须点播放器本身：过一会儿还没动就提示一下
    setTimeout(function () {
      if (v.dead || playing(v)) return;
      var st; try { st = v.player.getPlayerState(); } catch (e) { return; }
      if (st === -1 || st === 5) { v.needTap = true; paintStatus(v); }
    }, 1500);
  }

  function copyText(text, btn) {
    function done(ok) {
      var old = btn.textContent;
      btn.textContent = ok ? '已复制' : '复制失败';
      setTimeout(function () { btn.textContent = old; }, 1600);
    }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
      document.body.appendChild(ta); ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
      done(ok);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
    } else fallback();
  }

  var RATES = [1, 1.25, 0.75];

  function bindClip(v) {
    var root = app.querySelector('.clip');
    root.addEventListener('click', function (ev) {
      if (v.dead) return;
      var t = ev.target;

      var hl = t.closest('.hl');
      if (hl) { // 点高亮：展开/收起注释，不跳转
        ev.stopPropagation();
        var cue = hl.closest('.cue');
        var s = v.sents[+cue.dataset.n], item = (s.hl || [])[+hl.dataset.k];
        if (!item || !item.note) return;
        var old = cue.querySelector('.hl-note[data-k="' + hl.dataset.k + '"]');
        if (old) { old.remove(); return; }
        var d = document.createElement('div');
        d.className = 'hl-note'; d.dataset.k = hl.dataset.k;
        d.innerHTML = '<b lang="en">' + esc(item.text) + '</b>　' + esc(item.note);
        cue.insertBefore(d, cue.querySelector('.zh'));
        return;
      }
      if (t.closest('.hl-note')) return;

      var cueEl = t.closest('.cue');
      if (cueEl) { goSent(v, +cueEl.dataset.n, false); return; }

      var sh = t.closest('[data-shadow]');
      if (sh) {
        var n = +sh.dataset.shadow;
        setCur(v, n, 'none');
        setLoop(v, true);
        v.loopIdx = n; paintLoop(v);
        v.hold = Date.now();
        seek(v, v.sents[n].s, true);
        return;
      }
      var ch = t.closest('[data-chunk]');
      if (ch) { goSent(v, +ch.dataset.chunk, true); return; }

      var btn = t.closest('[data-act]');
      if (!btn) return;
      var act = btn.dataset.act;
      if (act === 'prev') goSent(v, (v.loop ? v.loopIdx : v.cur) - 1, true);
      else if (act === 'next') goSent(v, (v.loop ? v.loopIdx : v.cur) + 1, true);
      else if (act === 'play') togglePlay(v);
      else if (act === 'back') nudge(v, -3);
      else if (act === 'fwd') nudge(v, 3);
      else if (act === 'again') again(v);
      else if (act === 'loop') setLoop(v, !v.loop);
      else if (act === 'stop1') setStop1(v, !v.stop1);
      else if (act === 'replay') { setLoop(v, false); v.seg = null; setCur(v, v.sents.length ? 0 : -1, 'force'); v.hold = Date.now(); seek(v, v.start, true); }
      else if (act === 'rate') {
        v.rate = RATES[(RATES.indexOf(v.rate) + 1) % RATES.length];
        btn.textContent = '速度 ' + v.rate + '×';
        try { if (v.ready) v.player.setPlaybackRate(v.rate); } catch (e) {}
      }
      else if (act === 'zh' || act === 'en') {
        var hidden = document.body.classList.toggle('hide-' + act);
        btn.setAttribute('aria-pressed', hidden ? 'false' : 'true');
        btn.classList.toggle('off', hidden);
      }
      else if (act === 'copy') copyText((v.clip.questions || []).filter(Boolean).join('\n'), btn);
    });

    root.addEventListener('keydown', function (ev) {
      if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.classList && ev.target.classList.contains('cue')) {
        ev.preventDefault();
        goSent(v, +ev.target.dataset.n, false);
      }
    });
  }

  // 键盘：空格 播放/暂停，←/→ 上一句/下一句，L 单句循环
  document.addEventListener('keydown', function (ev) {
    var v = view;
    if (!v || !v.sents || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    var tag = ev.target && ev.target.tagName;
    if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (ev.target.classList && ev.target.classList.contains('cue')) return;
    if (ev.key === ' ') { ev.preventDefault(); togglePlay(v); }
    else if (ev.key === 'ArrowLeft') goSent(v, (v.loop ? v.loopIdx : v.cur) - 1, true);
    else if (ev.key === 'ArrowRight') goSent(v, (v.loop ? v.loopIdx : v.cur) + 1, true);
    else if (ev.key === 'l' || ev.key === 'L') setLoop(v, !v.loop);
    else if (ev.key === ',' || ev.key === 'j' || ev.key === 'J') nudge(v, -3);
    else if (ev.key === '.' || ev.key === 'k' || ev.key === 'K') nudge(v, 3);
    else if (ev.key === 'r' || ev.key === 'R') again(v);
    else if (ev.key === 's' || ev.key === 'S') setStop1(v, !v.stop1);
  });

  route();
})();
