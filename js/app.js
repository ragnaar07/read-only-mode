(function(){
  "use strict";

  var STORE_KEY = "timelog-v1";
  var UI_PREFS_KEY = "timelog-ui-v1";
  var HISTORY_PAGE = 20;
  var historyShown = HISTORY_PAGE;
  var tickInterval = null;
  var notifyInterval = null;
  var swRegistration = null;

  function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
  function pad(n){ return String(n).padStart(2,"0"); }
  function todayKey(d){
    d = d || new Date();
    return d.getFullYear() + "-" + pad(d.getMonth()+1) + "-" + pad(d.getDate());
  }
  function daysAgo(n){ var d = new Date(); d.setDate(d.getDate()-n); return d; }
  function fmtDur(sec){
    sec = Math.floor(sec);
    var h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60);
    if(h > 0) return h + "h " + m + "m";
    if(m > 0) return m + "m";
    return sec + "s";
  }
  function fmtClock(sec){
    sec = Math.floor(sec);
    var h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = sec%60;
    return pad(h) + ":" + pad(m) + ":" + pad(s);
  }
  function escapeHtml(s){
    var d = document.createElement("div"); d.textContent = s; return d.innerHTML;
  }

  // ---------- Storage ----------
  function load(){
    try{
      var raw = localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : {records:{}, activeSession:null, recurringTasks:[]};
    }catch(e){ return {records:{}, activeSession:null, recurringTasks:[]}; }
  }
  function save(){
    try{ localStorage.setItem(STORE_KEY, JSON.stringify(data)); }
    catch(e){ console.error("save failed", e); }
  }
  var data = load();
  if(!data.records) data.records = {};
  if(data.activeSession === undefined) data.activeSession = null;
  if(!data.recurringTasks) data.recurringTasks = []; // [{id, name}]

  function loadPrefs(){
    try{
      var raw = localStorage.getItem(UI_PREFS_KEY);
      return raw ? JSON.parse(raw) : {theme:"light", notifications:false};
    }catch(e){ return {theme:"light", notifications:false}; }
  }
  function savePrefs(){
    try{ localStorage.setItem(UI_PREFS_KEY, JSON.stringify(ui)); }
    catch(e){ console.error("prefs save failed", e); }
  }
  var ui = loadPrefs();
  if(ui.theme !== "dark") ui.theme = "light";
  ui.notifications = !!ui.notifications;

  function getRecord(key){
    if(!data.records[key]) data.records[key] = {tasks:[], sessions:[]};
    if(!data.records[key].tasks) data.records[key].tasks = [];
    if(!data.records[key].sessions) data.records[key].sessions = [];
    return data.records[key];
  }

  // Ensure every recurring template has a task entry in today's record.
  function ensureRecurringToday(){
    var rec = getRecord(todayKey());
    var existingIds = rec.tasks.filter(function(t){ return t.recurringId; })
      .map(function(t){ return t.recurringId; });
    data.recurringTasks.forEach(function(tpl){
      if(existingIds.indexOf(tpl.id) === -1){
        rec.tasks.push({id: uid(), name: tpl.name, done:false, recurringId: tpl.id});
      }
    });
    save();
  }

  function dayTotalSec(rec){
    if(!rec || !rec.sessions) return 0;
    return rec.sessions.reduce(function(s,ses){ return s + ses.durationSec; }, 0);
  }
  function dayTaskPct(rec){
    if(!rec || !rec.tasks || !rec.tasks.length) return 0;
    var done = rec.tasks.filter(function(t){ return t.done; }).length;
    return Math.round((done/rec.tasks.length)*100);
  }
  function allTimeTotalSec(){
    return Object.keys(data.records).reduce(function(sum,k){
      return sum + dayTotalSec(data.records[k]);
    }, 0);
  }

  // ---------- UI preferences ----------
  function applyTheme(){
    document.body.setAttribute("data-theme", ui.theme);
    var btn = document.getElementById("theme-toggle");
    if(btn){
      btn.textContent = ui.theme === "dark" ? "☀" : "☾";
      btn.setAttribute("aria-label", ui.theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
    }
    var meta = document.querySelector('meta[name="theme-color"]');
    if(meta) meta.setAttribute("content", ui.theme === "dark" ? "#0b1020" : "#f6f7fb");
  }

  function notificationsSupported(){
    return "Notification" in window;
  }
  function canNotify(){
    return ui.notifications && notificationsSupported() && Notification.permission === "granted";
  }
  function renderNotifyButton(){
    var btn = document.getElementById("notify-btn");
    if(!btn) return;
    if(!notificationsSupported()){
      btn.textContent = "Notifications unavailable";
      btn.disabled = true;
      btn.classList.remove("on");
      return;
    }
    if(Notification.permission === "denied"){
      btn.textContent = "Notifications blocked";
      btn.classList.remove("on");
      return;
    }
    btn.textContent = ui.notifications && Notification.permission === "granted" ? "Notifications on" : "Notifications off";
    btn.classList.toggle("on", ui.notifications && Notification.permission === "granted");
  }
  function activeNotificationPayload(status, activity, elapsedSec){
    var title = status === "done" ? "Timer saved" : (status === "paused" ? "Timer paused" : "Timer running");
    return {
      title: title,
      body: activity + " • " + fmtDur(elapsedSec || 0),
      tag: status === "done" ? "timelog-complete" : "timelog-active",
      requireInteraction: status !== "done",
      silent: status !== "done",
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      data: {url:"./index.html"}
    };
  }
  function getServiceWorkerRegistration(){
    if(!("serviceWorker" in navigator)) return Promise.resolve(null);
    if(swRegistration) return Promise.resolve(swRegistration);
    return navigator.serviceWorker.ready.then(function(reg){
      swRegistration = reg;
      return reg;
    }).catch(function(){ return null; });
  }
  function closeActiveTimerNotification(){
    if(!canNotify()) return;
    getServiceWorkerRegistration().then(function(reg){
      if(reg && reg.getNotifications){
        reg.getNotifications({tag:"timelog-active"}).then(function(list){
          list.forEach(function(n){ n.close(); });
        });
      }
    });
  }
  function showTimerNotification(status, activity, elapsedSec){
    if(!canNotify()) return;
    var payload = activeNotificationPayload(status, activity, elapsedSec);
    getServiceWorkerRegistration().then(function(reg){
      var opts = {
        body: payload.body,
        tag: payload.tag,
        requireInteraction: payload.requireInteraction,
        silent: payload.silent,
        icon: payload.icon,
        badge: payload.badge,
        data: payload.data
      };
      if(reg && reg.showNotification){
        reg.showNotification(payload.title, opts);
      } else {
        new Notification(payload.title, opts);
      }
    });
  }
  function startNotifyTick(){
    stopNotifyTick();
    var a = data.activeSession;
    if(!a || !a.running || !canNotify()) return;
    notifyInterval = setInterval(function(){
      var cur = data.activeSession;
      if(cur && cur.running) showTimerNotification("running", cur.activity, activeElapsedSec());
    }, 60000);
  }
  function stopNotifyTick(){
    if(notifyInterval){ clearInterval(notifyInterval); notifyInterval = null; }
  }

  // ---------- Timer core ----------
  function activeElapsedSec(){
    var a = data.activeSession;
    if(!a) return 0;
    var extra = 0;
    if(a.running && a.segStart){
      extra = (Date.now() - new Date(a.segStart).getTime()) / 1000;
    }
    return a.elapsedBeforePause + extra;
  }

  function startTimer(activity){
    activity = (activity || "").trim();
    if(!activity) return;
    if(data.activeSession){ stopTimer(); }
    data.activeSession = {
      activity: activity,
      firstStart: new Date().toISOString(),
      elapsedBeforePause: 0,
      running: true,
      segStart: new Date().toISOString()
    };
    save();
    renderTimer();
    startTick();
    showTimerNotification("running", activity, 0);
    startNotifyTick();
  }
  function pauseTimer(){
    var a = data.activeSession;
    if(!a || !a.running) return;
    a.elapsedBeforePause = activeElapsedSec();
    a.running = false;
    a.segStart = null;
    save();
    renderTimer();
    stopTick();
    showTimerNotification("paused", a.activity, a.elapsedBeforePause);
    stopNotifyTick();
  }
  function resumeTimer(){
    var a = data.activeSession;
    if(!a || a.running) return;
    a.running = true;
    a.segStart = new Date().toISOString();
    save();
    renderTimer();
    startTick();
    showTimerNotification("running", a.activity, a.elapsedBeforePause);
    startNotifyTick();
  }
  function stopTimer(){
    var a = data.activeSession;
    if(!a) return;
    var elapsed = Math.round(activeElapsedSec());
    if(elapsed > 0){
      var key = todayKey(new Date(a.firstStart));
      var rec = getRecord(key);
      rec.sessions.push({id: uid(), activity: a.activity, startTime: a.firstStart, durationSec: elapsed});
    }
    data.activeSession = null;
    save();
    stopTick();
    stopNotifyTick();
    closeActiveTimerNotification();
    showTimerNotification("done", a.activity, elapsed);
    renderTimer();
    renderTasks();
    renderFooterStats();
  }

  function startTick(){
    stopTick();
    tickInterval = setInterval(function(){
      var a = data.activeSession;
      if(!a) return;
      document.getElementById("active-clock").textContent = fmtClock(activeElapsedSec());
    }, 1000);
  }
  function stopTick(){
    if(tickInterval){ clearInterval(tickInterval); tickInterval = null; }
  }

  function renderTimer(){
    var a = data.activeSession;
    var idle = document.getElementById("timer-idle");
    var activeEl = document.getElementById("active-timer");
    if(a){
      idle.style.display = "none";
      activeEl.classList.add("show");
      activeEl.classList.toggle("paused", !a.running);
      document.getElementById("active-activity").textContent = a.activity;
      document.getElementById("active-clock").textContent = fmtClock(activeElapsedSec());
      document.getElementById("pause-btn").textContent = a.running ? "Pause" : "Resume";
      if(a.running) startTick(); else stopTick();
    } else {
      idle.style.display = "";
      activeEl.classList.remove("show");
      document.getElementById("activity-input").value = "";
    }
  }

  // ---------- Tasks ----------
  function renderTasks(){
    ensureRecurringToday();
    var key = todayKey();
    var rec = getRecord(key);
    var list = document.getElementById("task-list");
    list.innerHTML = "";
    if(!rec.tasks.length){
      list.innerHTML = '<div class="empty">No tasks yet today. Add one above.</div>';
    } else {
      rec.tasks.forEach(function(t){
        var timeSpent = rec.sessions.filter(function(s){ return s.activity === t.name; })
          .reduce(function(s,ses){ return s + ses.durationSec; }, 0);
        var row = document.createElement("div");
        row.className = "task" + (t.done ? " done" : "");
        row.innerHTML =
          '<div class="box' + (t.done ? " on" : "") + '" data-role="toggle"><svg viewBox="0 0 24 24" fill="none" stroke="#0d1117" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>' +
          '<div class="task-name" data-role="start">' + escapeHtml(t.name) + '</div>' +
          (t.recurringId ? '<div class="task-repeat-icon">🔁</div>' : '') +
          (timeSpent > 0 ? '<div class="task-time">' + fmtDur(timeSpent) + '</div>' : '') +
          '<button class="task-del" data-role="del">✕</button>';
        row.querySelector('[data-role="toggle"]').addEventListener("click", function(){
          t.done = !t.done; save(); renderTasks(); renderFooterStats();
        });
        row.querySelector('[data-role="start"]').addEventListener("click", function(){
          startTimer(t.name);
        });
        row.querySelector('[data-role="del"]').addEventListener("click", function(e){
          e.stopPropagation();
          rec.tasks = rec.tasks.filter(function(x){ return x.id !== t.id; });
          save(); renderTasks(); renderFooterStats();
        });
        list.appendChild(row);
      });
    }
    renderRecurringList();
  }

  function renderRecurringList(){
    var block = document.getElementById("recurring-block");
    var listEl = document.getElementById("recurring-list");
    if(!data.recurringTasks.length){
      block.style.display = "none";
      return;
    }
    block.style.display = "";
    listEl.innerHTML = "";
    data.recurringTasks.forEach(function(tpl){
      var row = document.createElement("div");
      row.className = "recurring-row";
      row.innerHTML = '<span class="rname">🔁 ' + escapeHtml(tpl.name) + '</span><button data-role="stop">Stop repeating</button>';
      row.querySelector('[data-role="stop"]').addEventListener("click", function(){
        data.recurringTasks = data.recurringTasks.filter(function(x){ return x.id !== tpl.id; });
        save();
        renderTasks();
      });
      listEl.appendChild(row);
    });
  }

  // ---------- Footer stats ----------
  function calcStreak(){
    var streak = 0;
    var d = new Date();
    var key = todayKey(d);
    var rec = data.records[key];
    function counts(r){ return r && (dayTotalSec(r) > 0 || (r.tasks.length && dayTaskPct(r) === 100)); }
    if(!counts(rec)) d = daysAgo(1);
    while(true){
      var k = todayKey(d);
      var r = data.records[k];
      if(counts(r)){ streak++; d.setDate(d.getDate()-1); }
      else break;
    }
    return streak;
  }
  function renderFooterStats(){
    var rec = getRecord(todayKey());
    document.getElementById("stat-time").textContent = fmtDur(dayTotalSec(rec));
    document.getElementById("stat-tasks").textContent = dayTaskPct(rec) + "%";
    document.getElementById("stat-streak").textContent = calcStreak();
  }

  // ---------- Progress tab ----------
  function renderProgress(){
    var todayTotal = dayTotalSec(getRecord(todayKey()));
    var weekTotal = 0;
    for(var wi=6;wi>=0;wi--){
      weekTotal += dayTotalSec(data.records[todayKey(daysAgo(wi))]);
    }
    document.getElementById("progress-today").textContent = fmtDur(todayTotal);
    document.getElementById("progress-week").textContent = fmtDur(weekTotal);
    document.getElementById("progress-total").textContent = fmtDur(allTimeTotalSec());

    var chart = document.getElementById("week-chart");
    chart.innerHTML = "";
    var labels = ["M","T","W","T","F","S","S"];
    var maxSec = 1;
    for(var i=6;i>=0;i--){
      var r = data.records[todayKey(daysAgo(i))];
      maxSec = Math.max(maxSec, dayTotalSec(r));
    }
    for(var i=6;i>=0;i--){
      var d = daysAgo(i);
      var k = todayKey(d);
      var r = data.records[k];
      var sec = r ? dayTotalSec(r) : 0;
      var pct = Math.round((sec/maxSec)*100);
      var jsDay = d.getDay();
      var labelIdx = jsDay === 0 ? 6 : jsDay - 1;
      var isToday = i === 0;
      var col = document.createElement("div");
      col.className = "wc-col";
      col.innerHTML =
        '<div class="wc-bar" style="height:' + Math.max(pct,sec>0?4:2) + '%; background:' + (sec>0 ? "var(--green)" : "var(--border)") + '"><span>' + (sec>0? fmtDur(sec):"") + '</span></div>' +
        '<div class="wc-label' + (isToday ? " today" : "") + '">' + labels[labelIdx] + '</div>';
      chart.appendChild(col);
    }

    var totals = {};
    Object.keys(data.records).forEach(function(k){
      var r = data.records[k];
      if(r && r.sessions) r.sessions.forEach(function(s){
        totals[s.activity] = (totals[s.activity]||0) + s.durationSec;
      });
    });
    renderActivityBars(document.getElementById("activity-progress"), totals, "No activity logged yet.");
  }

  function renderActivityBars(container, totals, emptyText){
    container.innerHTML = "";
    var keys = Object.keys(totals).sort(function(a,b){ return totals[b]-totals[a]; });
    if(!keys.length){
      container.innerHTML = '<div class="empty">' + emptyText + '</div>';
    } else {
      var grand = keys.reduce(function(s,k){ return s+totals[k]; },0) || 1;
      keys.slice(0,10).forEach(function(name){
        var pct = Math.round((totals[name]/grand)*100);
        var row = document.createElement("div");
        row.className = "habit-row";
        row.innerHTML =
          '<div class="hr-name">' + escapeHtml(name) + '</div>' +
          '<div class="hr-track"><div class="hr-fill" style="width:' + pct + '%; background:var(--blue);"></div></div>' +
          '<div class="hr-pct">' + fmtDur(totals[name]) + '</div>';
        container.appendChild(row);
      });
    }
  }

  // ---------- Heatmap ----------
  function renderHeatmap(){
    var grid = document.getElementById("hm-grid");
    var monthsEl = document.getElementById("hm-months");
    grid.innerHTML = ""; monthsEl.innerHTML = "";

    var totalDays = 371;
    var end = new Date();
    var endDow = end.getDay();
    end.setDate(end.getDate() + (6-endDow));
    var start = new Date(end);
    start.setDate(start.getDate() - totalDays + 1);
    start.setDate(start.getDate() - start.getDay());

    var weeks = [];
    var cur = new Date(start);
    while(cur <= end){
      var week = [];
      for(var i=0;i<7;i++){
        week.push(new Date(cur));
        cur.setDate(cur.getDate()+1);
      }
      weeks.push(week);
    }

    var activeDays = 0;
    var lastMonth = -1;
    weeks.forEach(function(week, wi){
      var col = document.createElement("div");
      col.className = "hm-week";
      week.forEach(function(day){
        var cell = document.createElement("div");
        cell.className = "hm-cell";
        if(day > new Date()){
          cell.style.background = "transparent";
        } else {
          var k = todayKey(day);
          var r = data.records[k];
          var sec = r ? dayTotalSec(r) : 0;
          if(sec > 0) activeDays++;
          var color = "var(--border)";
          if(sec > 0 && sec <= 30*60) color = "var(--green1)";
          else if(sec > 30*60 && sec <= 90*60) color = "var(--green2)";
          else if(sec > 90*60 && sec <= 180*60) color = "var(--green3)";
          else if(sec > 180*60) color = "var(--green)";
          cell.style.background = color;
          cell.addEventListener("mouseenter", function(e){ showTip(e, day, sec); });
          cell.addEventListener("mousemove", function(e){ moveTip(e); });
          cell.addEventListener("mouseleave", hideTip);
          cell.addEventListener("click", function(e){ showTip(e, day, sec); setTimeout(hideTip, 1800); });
        }
        col.appendChild(cell);
      });
      grid.appendChild(col);
      var firstDay = week[0];
      if(firstDay.getMonth() !== lastMonth && firstDay <= new Date()){
        lastMonth = firstDay.getMonth();
        var lbl = document.createElement("div");
        lbl.className = "hm-month-label";
        lbl.style.left = (wi*14) + "px";
        lbl.textContent = firstDay.toLocaleDateString(undefined,{month:'short'});
        monthsEl.appendChild(lbl);
      }
    });

    document.getElementById("heatmap-header").textContent = activeDays + " active days in the last year";
  }
  function showTip(e, day, sec){
    var tip = document.getElementById("hm-tooltip");
    var dateStr = day.toLocaleDateString(undefined,{month:'long',day:'numeric',year:'numeric'});
    tip.textContent = (sec > 0 ? fmtDur(sec) + " tracked" : "No activity") + " on " + dateStr;
    tip.style.display = "block";
    moveTip(e);
  }
  function moveTip(e){
    var tip = document.getElementById("hm-tooltip");
    var x = e.clientX, y = e.clientY;
    tip.style.left = Math.min(x+12, window.innerWidth-180) + "px";
    tip.style.top = (y-36) + "px";
  }
  function hideTip(){ document.getElementById("hm-tooltip").style.display = "none"; }

  // ---------- History ----------
  function renderHistory(){
    var list = document.getElementById("history-list");
    var keys = Object.keys(data.records).sort().reverse().filter(function(k){
      var r = data.records[k];
      return r && (r.sessions.length || r.tasks.length);
    });
    if(!keys.length){
      list.innerHTML = '<div class="empty">No history yet. Track something to get started.</div>';
      document.getElementById("load-more-btn").style.display = "none";
      return;
    }
    list.innerHTML = "";
    var shown = keys.slice(0, historyShown);
    shown.forEach(function(k){
      var r = data.records[k];
      var totals = {};
      r.sessions.forEach(function(s){ totals[s.activity] = (totals[s.activity]||0)+s.durationSec; });
      var activityKeys = Object.keys(totals).sort(function(a,b){ return totals[b]-totals[a]; });
      var doneTasks = r.tasks.filter(function(t){ return t.done; }).length;
      var openTasks = r.tasks.length - doneTasks;
      var d = new Date(k+"T00:00:00");
      var block = document.createElement("div");
      block.className = "day-block";
      var activityHtml = activityKeys.length ? '<div class="history-subtitle">Activities</div><div class="history-activities">' +
        activityKeys.map(function(a){
          return '<span class="history-chip">' + escapeHtml(a) + ' · ' + fmtDur(totals[a]) + '</span>';
        }).join("") + '</div>' : '<div class="day-block-detail">No timer sessions logged.</div>';
      var taskHtml = r.tasks.length ? '<div class="history-subtitle">Tasks</div><div class="history-tasks">' +
        r.tasks.map(function(t){
          return '<span class="history-chip ' + (t.done ? "task-done" : "task-open") + '">' + (t.done ? "Done · " : "Open · ") + escapeHtml(t.name) + '</span>';
        }).join("") + '</div>' : "";
      block.innerHTML =
        '<div class="day-block-head"><span class="day-block-date">' + d.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'}) + '</span>' +
        '<span class="day-block-meta">' + fmtDur(dayTotalSec(r)) + '</span></div>' +
        '<div class="day-block-stats">' +
          '<div class="day-mini"><strong>' + fmtDur(dayTotalSec(r)) + '</strong><span>tracked</span></div>' +
          '<div class="day-mini"><strong>' + (r.tasks.length ? dayTaskPct(r) + "%" : "-") + '</strong><span>tasks done</span></div>' +
          '<div class="day-mini"><strong>' + r.sessions.length + '</strong><span>sessions</span></div>' +
        '</div>' +
        activityHtml +
        (r.tasks.length ? '<div class="day-block-detail">' + doneTasks + ' done, ' + openTasks + ' open</div>' : '') +
        taskHtml;
      list.appendChild(block);
    });
    document.getElementById("load-more-btn").style.display = historyShown < keys.length ? "" : "none";
  }

  // ---------- Nav ----------
  function switchView(view){
    document.querySelectorAll(".view").forEach(function(v){ v.classList.remove("active"); });
    document.getElementById("view-"+view).classList.add("active");
    document.querySelectorAll("nav button").forEach(function(b){
      b.classList.toggle("active", b.dataset.view === view);
    });
    if(view === "progress") renderProgress();
    if(view === "heatmap") renderHeatmap();
    if(view === "history"){ historyShown = HISTORY_PAGE; renderHistory(); }
  }
  document.querySelectorAll("nav button").forEach(function(b){
    b.addEventListener("click", function(){ switchView(b.dataset.view); });
  });

  // ---------- Wire up ----------
  document.getElementById("theme-toggle").addEventListener("click", function(){
    ui.theme = ui.theme === "dark" ? "light" : "dark";
    savePrefs();
    applyTheme();
  });
  document.getElementById("notify-btn").addEventListener("click", function(){
    if(!notificationsSupported()) return;
    if(Notification.permission === "granted"){
      ui.notifications = !ui.notifications;
      savePrefs();
      renderNotifyButton();
      if(ui.notifications && data.activeSession){
        showTimerNotification(data.activeSession.running ? "running" : "paused", data.activeSession.activity, activeElapsedSec());
        startNotifyTick();
      } else {
        stopNotifyTick();
        closeActiveTimerNotification();
      }
      return;
    }
    Notification.requestPermission().then(function(permission){
      ui.notifications = permission === "granted";
      savePrefs();
      renderNotifyButton();
      if(ui.notifications && data.activeSession){
        showTimerNotification(data.activeSession.running ? "running" : "paused", data.activeSession.activity, activeElapsedSec());
        startNotifyTick();
      }
    });
  });

  document.getElementById("start-btn").addEventListener("click", function(){
    startTimer(document.getElementById("activity-input").value);
  });
  document.getElementById("activity-input").addEventListener("keydown", function(e){
    if(e.key === "Enter") startTimer(this.value);
  });
  document.getElementById("pause-btn").addEventListener("click", function(){
    var a = data.activeSession;
    if(a && a.running) pauseTimer(); else resumeTimer();
  });
  document.getElementById("stop-btn").addEventListener("click", stopTimer);

  document.getElementById("task-add-btn").addEventListener("click", addTask);
  document.getElementById("task-input").addEventListener("keydown", function(e){
    if(e.key === "Enter") addTask();
  });
  function addTask(){
    var input = document.getElementById("task-input");
    var repeatBox = document.getElementById("repeat-checkbox");
    var name = input.value.trim();
    if(!name) return;
    var rec = getRecord(todayKey());
    if(repeatBox.checked){
      var tplId = uid();
      data.recurringTasks.push({id: tplId, name: name});
      rec.tasks.push({id: uid(), name: name, done:false, recurringId: tplId});
    } else {
      rec.tasks.push({id: uid(), name: name, done:false});
    }
    save();
    input.value = "";
    repeatBox.checked = false;
    renderTasks();
    renderFooterStats();
  }

  document.getElementById("export-btn").addEventListener("click", function(){
    var blob = new Blob([JSON.stringify(data,null,2)], {type:"application/json"});
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = "timelog-backup-" + todayKey() + ".json"; a.click();
    URL.revokeObjectURL(url);
  });
  document.getElementById("load-more-btn").addEventListener("click", function(){
    historyShown += HISTORY_PAGE; renderHistory();
  });

  // ---------- Service worker ----------
  if("serviceWorker" in navigator){
    window.addEventListener("load", function(){
      navigator.serviceWorker.register("sw.js").catch(function(err){
        console.warn("SW registration failed", err);
      }).then(function(reg){
        if(reg) swRegistration = reg;
      });
    });
  }

  // ---------- Init ----------
  applyTheme();
  renderNotifyButton();
  document.getElementById("today-date").textContent = new Date().toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});
  renderTimer();
  renderTasks();
  renderFooterStats();
  startNotifyTick();
})();
