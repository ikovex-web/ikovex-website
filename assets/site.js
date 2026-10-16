/* Ikovex shared script, loaded on every page (home, privacy, terms, 404).

   SETTINGS — the only three values you ever need to change.
   None of these are secrets: each one is a public ID that is designed to sit in
   a web page. Real secrets (passwords, API keys, tokens) must never be put in
   any file of this site, because everything here is downloadable by anyone.

   sheetEndpoint The Google Apps Script web app URL from SETUP-GOOGLE-SHEET.md,
                 looks like 'https://script.google.com/macros/s/AKfy.../exec'.
                 When set, every request is saved to your Google Sheet, emailed
                 to ikovex.support@gmail.com, and the customer gets a
                 confirmation email. When empty, FormSubmit below is used.
   formEndpoint  Backup only. After you activate FormSubmit, it emails you a random alias.
                 Replace the Gmail address below with that alias so your inbox
                 address no longer appears in the page code:
                 'https://formsubmit.co/ajax/YOUR_RANDOM_ALIAS'
   gaId          Google Analytics 4 measurement ID, looks like 'G-ABC123XYZ'.
                 Leave empty and no analytics loads at all.
   sentryDsn     Optional Sentry error monitoring DSN from sentry.io.
                 Leave empty to report errors to Google Analytics instead. */
window.IKOVEX = window.IKOVEX || {
  sheetEndpoint: 'https://script.google.com/macros/s/AKfycbwK59bb5MATFKYYNX5Qw_u2mmhlDdvjKChgTF5vOJwekN53uFCiy2qegjhAGZmWMkzDsw/exec',
  formEndpoint: 'https://formsubmit.co/ajax/ikovex.support@gmail.com',
  gaId: '',
  sentryDsn: ''
};

(function(){
  var cfg = window.IKOVEX;
  var host = location.hostname;
  var isLocal = location.protocol === 'file:' || host === 'localhost' || host === '127.0.0.1' || host === '';
  var isPreview = /claude\.(ai|site)|claudeusercontent/.test(host);

  /* 1. FORCE HTTPS — backup for GitHub Pages' "Enforce HTTPS" setting. */
  if(location.protocol === 'http:' && !isLocal){
    location.replace('https://' + location.host + location.pathname + location.search + location.hash);
    return;
  }

  /* 2. EMAIL PROTECTION — addresses are written as data attributes and
     assembled here, so spam bots scanning the page source can't harvest them. */
  function buildEmails(){
    document.querySelectorAll('[data-email-user]').forEach(function(a){
      var addr = a.getAttribute('data-email-user') + '@' + a.getAttribute('data-email-domain');
      a.href = 'mailto:' + addr;
      if(!a.hasAttribute('data-keep-text')) a.textContent = addr;
    });
  }

  /* 3. ERROR MONITORING
     Sentry when a DSN is set; otherwise JavaScript errors are sent to
     Google Analytics as "exception" events (only after cookie consent). */
  var errorQueue = [];
  function reportError(msg){
    msg = String(msg || 'Unknown error').slice(0, 150);
    if(window.gtag && consent() === 'granted') window.gtag('event', 'exception', { description: msg, fatal: false, page_path: location.pathname });
    else if(errorQueue.length < 10) errorQueue.push(msg);
  }
  window.addEventListener('error', function(e){ reportError((e.message || 'error') + ' @ ' + (e.filename || '').split('/').pop() + ':' + (e.lineno || 0)); });
  window.addEventListener('unhandledrejection', function(e){ reportError('Promise: ' + (e.reason && e.reason.message || e.reason)); });
  window.ikovexReportError = reportError;
  if(cfg.sentryDsn && !isLocal && !isPreview){
    var m = cfg.sentryDsn.match(/^https:\/\/([a-f0-9]+)@/);
    if(m){
      var s = document.createElement('script');
      s.src = 'https://js.sentry-cdn.com/' + m[1] + '.min.js';
      s.crossOrigin = 'anonymous';
      document.head.appendChild(s);
    }
  }

  /* 4. COOKIE CONSENT + ANALYTICS
     Nothing is tracked until the visitor clicks Accept. Decline is just as
     easy as Accept. The choice is remembered for 12 months, and "Cookie
     settings" in the footer reopens the banner at any time. */
  var KEY = 'ikovex-consent', YEAR = 365*24*3600*1000;
  function consent(){
    try{
      var v = JSON.parse(localStorage.getItem(KEY) || 'null');
      if(v && (Date.now() - v.t) < YEAR) return v.c;
    }catch(e){}
    return null;
  }
  function saveConsent(c){ try{ localStorage.setItem(KEY, JSON.stringify({ c:c, t:Date.now() })); }catch(e){} }

  var gaLoaded = false;
  function loadAnalytics(){
    if(gaLoaded || !cfg.gaId || isLocal || isPreview) return;
    gaLoaded = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function(){ window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', cfg.gaId, { anonymize_ip: true });
    var s = document.createElement('script');
    s.async = true; s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(cfg.gaId);
    document.head.appendChild(s);
    errorQueue.splice(0).forEach(reportError);
  }
  function clearAnalyticsCookies(){
    document.cookie.split(';').forEach(function(c){
      var name = c.split('=')[0].trim();
      if(/^_ga/.test(name)){
        var parts = host.split('.'), domains = ['', host];
        if(parts.length > 1) domains.push('.' + parts.slice(-2).join('.'));
        domains.forEach(function(d){ document.cookie = name + '=; Max-Age=0; path=/' + (d ? '; domain=' + d : ''); });
      }
    });
  }

  /* Small helper for pages to record key actions (CTA clicks, sent forms). */
  window.ikovexTrack = function(name, params){
    if(window.gtag && consent() === 'granted') window.gtag('event', name, params || {});
  };

  var css = '\
.cookie-banner{position:fixed; left:20px; bottom:20px; z-index:100003; max-width:420px; background:#0F2438; color:#fff; border:1px solid rgba(255,255,255,.12);\
 border-radius:12px; padding:20px 22px; box-shadow:0 20px 50px rgba(0,0,0,.35); font:14.5px/1.6 "IBM Plex Sans", system-ui, sans-serif;\
 transform:translateY(20px); opacity:0; transition:opacity .3s ease, transform .35s cubic-bezier(.16,1,.3,1);}\
.cookie-banner.show{transform:none; opacity:1;}\
.cookie-banner h2{font:600 16px/1.3 "Space Grotesk", system-ui, sans-serif; margin:0 0 6px; color:#fff;}\
.cookie-banner p{margin:0 0 14px; color:#B7C2CB;}\
.cookie-banner a{color:#fff; font-weight:600;}\
.cookie-actions{display:flex; gap:10px; flex-wrap:wrap;}\
.cookie-actions button{flex:1; min-width:120px; font:600 14.5px/1 "IBM Plex Sans", system-ui, sans-serif; padding:12px 16px; border-radius:8px; cursor:pointer; border:1.5px solid #fff;}\
.cookie-accept{background:#fff; color:#0F2438;}\
.cookie-decline{background:transparent; color:#fff;}\
.cookie-actions button:hover{opacity:.9;}\
.cookie-actions button:focus-visible{outline:2px solid #F2848D; outline-offset:2px;}\
@media(max-width:560px){.cookie-banner{left:10px; right:10px; bottom:10px; max-width:none;}}\
@media(prefers-reduced-motion:reduce){.cookie-banner{transition:none;}}';

  function showBanner(){
    if(document.getElementById('cookie-banner')) return;
    if(!document.getElementById('cookie-css')){
      var st = document.createElement('style'); st.id = 'cookie-css'; st.textContent = css; document.head.appendChild(st);
    }
    var privacyHref = (document.documentElement.getAttribute('data-root') || '') + 'privacy.html#cookies';
    var b = document.createElement('section');
    b.id = 'cookie-banner'; b.className = 'cookie-banner';
    b.setAttribute('role', 'region'); b.setAttribute('aria-label', 'Cookie choice');
    b.innerHTML = '<h2>Your privacy, your choice</h2>' +
      '<p>We would like to use analytics cookies to see how visitors use our site so we can improve it. They are only set if you accept. Read more in our <a href="' + privacyHref + '">Privacy Policy</a>.</p>' +
      '<div class="cookie-actions"><button type="button" class="cookie-decline">Decline</button><button type="button" class="cookie-accept">Accept</button></div>';
    document.body.appendChild(b);
    document.documentElement.classList.add('cookie-open');
    requestAnimationFrame(function(){ b.classList.add('show'); });
    function close(choice){
      saveConsent(choice);
      if(choice === 'granted') loadAnalytics(); else clearAnalyticsCookies();
      b.classList.remove('show');
      document.documentElement.classList.remove('cookie-open');
      setTimeout(function(){ b.remove(); }, 350);
      document.dispatchEvent(new CustomEvent('ikovex:consent', { detail: choice }));
    }
    b.querySelector('.cookie-accept').addEventListener('click', function(){ close('granted'); });
    b.querySelector('.cookie-decline').addEventListener('click', function(){
      var wasGranted = consent() === 'granted';
      close('denied');
      if(wasGranted) setTimeout(function(){ location.reload(); }, 400); // fully stop analytics that already loaded
    });
  }
  window.ikovexCookieSettings = showBanner;

  function init(){
    buildEmails();
    document.querySelectorAll('[data-cookie-settings]').forEach(function(a){
      a.addEventListener('click', function(e){ e.preventDefault(); showBanner(); });
    });
    var c = consent();
    if(c === 'granted') loadAnalytics();
    else if(c === null) setTimeout(showBanner, 1800);
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
