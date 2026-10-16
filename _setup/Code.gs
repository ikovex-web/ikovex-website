/**
 * Ikovex website form  ->  Google Sheet + Gmail
 *
 * Every consultation request from ikovex.com is:
 *   1. checked again on the server (email format, typos, throwaway inboxes,
 *      the email domain really accepts mail, phone, spam traps, rate limits)
 *   2. saved as a new row in the "Leads" tab of this Google Sheet
 *   3. emailed to ikovex.support@gmail.com (press Reply to answer the customer)
 *   4. confirmed to the customer by email
 *
 * Paste this whole file into Extensions > Apps Script of your Google Sheet,
 * signed in as ikovex.support@gmail.com. Then run testSetup once.
 */

const CONFIG = {
  NOTIFY_EMAIL: 'ikovex.support@gmail.com',  // where new requests are sent
  SHEET_NAME: 'Leads',                        // tab for real requests (created automatically)
  SPAM_SHEET_NAME: 'Spam log',                // tab for blocked requests, so nothing disappears silently
  SPAM_LOG_MAX_ROWS: 1000,                    // stop logging spam after this many rows
  SEND_CONFIRMATION: true,                    // email the customer a "we got your request" note
  BUSINESS_NAME: 'Ikovex',
  MAX_PER_EMAIL_PER_HOUR: 3,                  // one address can't flood you
  MAX_PER_MINUTE_TOTAL: 20,                   // bots can't flood you
  MIN_FILL_TIME_MS: 4000                      // real people take longer than this to fill the form
};

const HEADERS = ['Received', 'Name', 'Business', 'Email', 'Phone', 'Services', 'Message', 'Email check', 'Page', 'Status', 'Notes'];
const STATUS_OPTIONS = ['New', 'Replied', 'Call booked', 'Quote sent', 'Won', 'Lost', 'Spam'];
const MAX_BODY_CHARS = 20000;

const DISPOSABLE = ('mailinator.com guerrillamail.com guerrillamail.net sharklasers.com 10minutemail.com 10minutemail.net tempmail.com temp-mail.org ' +
  'tempmail.net tempmailo.com yopmail.com yopmail.net trashmail.com trashmail.de getnada.com nada.email dispostable.com maildrop.cc mailnesia.com ' +
  'mintemail.com throwawaymail.com fakeinbox.com spamgourmet.com mailcatch.com moakt.com emailondeck.com tempinbox.com burnermail.io ' +
  'mohmal.com discard.email mytemp.email tempr.email 33mail.com spambox.us mailpoof.com inboxkitten.com fakemail.net emailfake.com ' +
  'mail.tm mail.gw tmpmail.org tmpmail.net mailsac.com anonaddy.me trbvm.com byom.de').split(' ');

/* common misspellings of big email providers (some of these are real, parked domains, so a mail server check alone won't catch them) */
const TYPO_DOMAINS = {
  'gmial.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gmaill.com': 'gmail.com', 'gnail.com': 'gmail.com',
  'gmail.co': 'gmail.com', 'gmail.con': 'gmail.com', 'gmail.cm': 'gmail.com', 'gmai.com': 'gmail.com', 'gmil.com': 'gmail.com',
  'hotmial.com': 'hotmail.com', 'hotmal.com': 'hotmail.com', 'hotnail.com': 'hotmail.com', 'hotmail.co': 'hotmail.com', 'hotmail.con': 'hotmail.com',
  'yahooo.com': 'yahoo.com', 'yaho.com': 'yahoo.com', 'yahoo.co': 'yahoo.com', 'yahoo.con': 'yahoo.com', 'yhoo.com': 'yahoo.com',
  'outlok.com': 'outlook.com', 'outloo.com': 'outlook.com', 'outlook.co': 'outlook.com', 'outlook.con': 'outlook.com',
  'iclod.com': 'icloud.com', 'icloud.co': 'icloud.com', 'icoud.com': 'icloud.com'
};

const EMAIL_FORMAT = /^(?!\.)(?!.*\.\.)[A-Za-z0-9._%+'-]{1,64}@(?=.{4,253}$)([A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,24}$/;
/* digits, spaces, + ( ) . - and an optional extension like "ext 12" or "x12" */
const PHONE_FORMAT = /^\+?[\d\s().-]{7,20}(\s*(ext\.?|x)\s*\d{1,6})?$/i;


/* ======================= web app entry points ======================= */

/* Opening the web app URL in a browser shows this, so you can confirm it is live. */
function doGet() {
  return json_({ ok: true, message: 'Ikovex form endpoint is running.' });
}

function doPost(e) {
  // 1. read the request safely
  const raw = (e && e.postData && typeof e.postData.contents === 'string') ? e.postData.contents : '';
  if (!raw) return fail_(null, 'The request was empty. Please try again.');
  if (raw.length > MAX_BODY_CHARS) return fail_('message', 'Your message is too long. Please shorten it and try again.');
  let d;
  try { d = JSON.parse(raw); } catch (err) { return fail_(null, 'The request could not be read. Please try again.'); }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return fail_(null, 'The request could not be read. Please try again.');

  try {
    // 2. spam traps. Bots get a normal "ok" so they learn nothing, and the attempt is logged in the Spam log tab.
    const elapsed = Number(d._elapsed);
    if (d._honey) return spam_('Hidden trap field filled', d);
    if (!isFinite(elapsed) || elapsed < CONFIG.MIN_FILL_TIME_MS) return spam_('Sent too fast or not from the website form', d);
    if ((text_(d.message).match(/https?:\/\/|www\./gi) || []).length > 2) return spam_('Too many links in the message', d);

    // 3. clean every field
    const f = {
      name: line_(d.name, 80),
      business: line_(d.business, 100),
      email: line_(d.email, 200).toLowerCase(),
      phone: line_(d.phone, 40),
      services: line_(d.services, 200) || 'Not specified',
      message: text_(d.message).slice(0, 2000),
      page: line_(d.page, 300)
    };

    // 4. validate
    if (f.name.length < 2 || /https?:|www\.|[<>@]/i.test(f.name)) return fail_('name', 'Please enter your name.');
    if (f.message.length < 5) return fail_('message', 'Please add a short message about what you need.');
    if (f.phone && (!PHONE_FORMAT.test(f.phone) || f.phone.replace(/\D/g, '').length < 7)) return fail_('phone', 'Please check your phone number.');
    if (d.consent !== true) return fail_('consent', 'Please tick the box to agree to the Privacy Policy so we can reply.');
    const emailResult = checkEmail_(f.email);
    if (!emailResult.ok) return fail_('email', emailResult.message);

    // 5. duplicates and rate limits
    const cache = CacheService.getScriptCache();
    const dupKey = key_('dup', f.email + '|' + f.message);
    if (cache.get(dupKey)) return json_({ ok: true, duplicate: true });       // double click: already saved
    const perEmailKey = key_('em', f.email);
    const sentForEmail = Number(cache.get(perEmailKey) || 0);
    if (sentForEmail >= CONFIG.MAX_PER_EMAIL_PER_HOUR) return fail_(null, 'We already have your recent requests and will reply soon.');
    const minuteKey = 'min_' + Math.floor(Date.now() / 60000);
    const thisMinute = Number(cache.get(minuteKey) || 0);
    if (thisMinute >= CONFIG.MAX_PER_MINUTE_TOTAL) return fail_(null, 'We are getting a lot of requests right now. Please try again in a minute.');

    // 6. save to the sheet. The lock stops two requests writing at the same instant;
    //    if it can't be had in 10s we still save, because losing a lead is worse.
    const lock = LockService.getScriptLock();
    const locked = lock.tryLock(10000);
    let sheet, rowNumber;
    try {
      sheet = getSheet_();
      sheet.appendRow([
        new Date(), safe_(f.name), safe_(f.business), safe_(f.email), safe_(f.phone),
        safe_(f.services), safe_(f.message), emailResult.note, safe_(f.page), 'New', ''
      ]);
      rowNumber = sheet.getLastRow();
    } finally {
      if (locked) lock.releaseLock();
    }
    cache.put(dupKey, '1', 600);
    cache.put(perEmailKey, String(sentForEmail + 1), 3600);
    cache.put(minuteKey, String(thisMinute + 1), 120);

    // 7. emails. The lead is already saved, so an email problem is only noted, never lost.
    const notes = [];
    try { notifyTeam_(f, emailResult.note); } catch (err) { notes.push('Team email not sent: ' + shortErr_(err)); }
    if (CONFIG.SEND_CONFIRMATION) {
      try { confirmCustomer_(f); } catch (err) { notes.push('Confirmation email not sent: ' + shortErr_(err)); }
    }
    if (notes.length) {
      try { sheet.getRange(rowNumber, HEADERS.indexOf('Notes') + 1).setValue(notes.join(' | ')); } catch (err) { console.error(err); }
    }

    return json_({ ok: true });
  } catch (err) {
    console.error('doPost failed', err);
    return fail_(null, 'Something went wrong on our side.');
  }
}


/* ======================= email checking ======================= */

/* returns { ok, message, note } */
function checkEmail_(email) {
  if (!email || email.length > 120 || !EMAIL_FORMAT.test(email) || /\.@/.test(email)) {
    return { ok: false, message: 'That email doesn\u2019t look right. Use a format like name@business.com.' };
  }
  const at = email.lastIndexOf('@');
  const user = email.slice(0, at), domain = email.slice(at + 1);
  if (TYPO_DOMAINS[domain]) {
    return { ok: false, message: 'Did you mean ' + user + '@' + TYPO_DOMAINS[domain] + '? Please check your email address.' };
  }
  if (DISPOSABLE.some(function (x) { return domain === x || domain.slice(-(x.length + 1)) === '.' + x; })) {
    return { ok: false, message: 'Please use your regular email address. Temporary inboxes can\u2019t receive our reply.' };
  }
  const mail = mailStatus_(domain);
  if (mail === false) {
    return { ok: false, message: 'We couldn\u2019t find an email service at ' + domain + '. Please check the spelling.' };
  }
  return { ok: true, note: mail === true ? 'Domain accepts email' : 'Domain not checked (lookup unavailable)' };
}

/* true  = the domain can receive email
   false = it definitely can't (domain doesn't exist, or it says "no mail here")
   null  = couldn't tell right now (DNS trouble); the customer is never blocked for this */
function mailStatus_(domain) {
  const cache = CacheService.getScriptCache();
  const k = key_('mx', domain);
  const hit = cache.get(k);
  if (hit === '1') return true;
  if (hit === '0') return false;

  const mx = dns_(domain, 'MX');
  let result;
  if (!mx) {
    result = null;                                                   // lookup failed
  } else if (mx.Status === 3) {
    result = false;                                                  // domain does not exist
  } else if (mx.Status !== 0) {
    result = null;                                                   // temporary DNS error
  } else {
    const records = (mx.Answer || []).filter(function (a) { return a.type === 15; });
    if (records.some(function (a) { return /^0\s+\.?$/.test(String(a.data).trim()); }) && records.length === 1) {
      result = false;                                                // "null MX": domain says it takes no email
    } else if (records.length) {
      result = true;
    } else {
      // no MX record: by the email standard, mail then goes to the domain's own address (A/AAAA record)
      const a = dns_(domain, 'A'), aaaa = a && (a.Answer || []).length ? null : dns_(domain, 'AAAA');
      if (!a || (a.Status !== 0 && a.Status !== 3)) result = null;
      else result = (a.Answer || []).some(function (r) { return r.type === 1; }) ||
                    !!(aaaa && (aaaa.Answer || []).some(function (r) { return r.type === 28; }));
    }
  }
  if (result === true) cache.put(k, '1', 21600);                    // remember good domains for 6 hours
  if (result === false) cache.put(k, '0', 1800);                    // remember bad ones for 30 minutes
  return result;
}

/* Google Public DNS over HTTPS. Returns the parsed answer, or null if it couldn't be read. */
function dns_(name, type) {
  try {
    const res = UrlFetchApp.fetch('https://dns.google/resolve?name=' + encodeURIComponent(name) + '&type=' + type, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;
    const j = JSON.parse(res.getContentText());
    return (j && typeof j.Status === 'number') ? j : null;
  } catch (err) {
    return null;
  }
}


/* ======================= sheets ======================= */

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(CONFIG.SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold').setBackground('#1B3A5C').setFontColor('#FFFFFF');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 150);
    sheet.setColumnWidth(7, 420);
    sheet.setColumnWidth(11, 260);
    sheet.getRange('A2:A').setNumberFormat('yyyy-mm-dd hh:mm');
    sheet.getRange('G2:G').setWrap(true);
    sheet.getRange('J2:J').setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(STATUS_OPTIONS, true).setAllowInvalid(false).build()
    );
  }
  return sheet;
}

/* Blocked requests are logged (not saved as leads, no emails sent) so nothing is ever lost without a trace. */
function spam_(reason, d) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let s = ss.getSheetByName(CONFIG.SPAM_SHEET_NAME);
    if (!s) {
      s = ss.insertSheet(CONFIG.SPAM_SHEET_NAME);
      s.appendRow(['Received', 'Reason', 'Name', 'Email', 'Message']);
      s.getRange(1, 1, 1, 5).setFontWeight('bold');
      s.setFrozenRows(1);
    }
    if (s.getLastRow() < CONFIG.SPAM_LOG_MAX_ROWS) {
      s.appendRow([new Date(), reason, safe_(line_(d.name, 80)), safe_(line_(d.email, 120)), safe_(text_(d.message).slice(0, 300))]);
    }
  } catch (err) {
    console.error('spam log failed', err);
  }
  return json_({ ok: true });
}


/* ======================= emails ======================= */

function notifyTeam_(f, emailNote) {
  const rows = [
    ['Name', f.name], ['Business', f.business || 'Not given'], ['Email', f.email], ['Phone', f.phone || 'Not given'],
    ['Services', f.services], ['Message', f.message], ['Email check', emailNote], ['Sent from', f.page || 'Website']
  ];
  const html =
    '<div style="font-family:Arial,sans-serif;max-width:620px">' +
    '<h2 style="color:#1B3A5C;margin:0 0 12px">New consultation request</h2>' +
    '<table cellpadding="8" style="border-collapse:collapse;width:100%;font-size:14px">' +
    rows.map(function (r) {
      return '<tr><td style="border:1px solid #E8E9E5;background:#F3F4F1;font-weight:bold;width:120px;vertical-align:top">' + esc_(r[0]) +
        '</td><td style="border:1px solid #E8E9E5;white-space:pre-wrap">' + esc_(r[1]) + '</td></tr>';
    }).join('') +
    '</table><p style="color:#4E5F6D;font-size:13px">Press Reply to answer ' + esc_(f.name) + ' directly. This request is also saved in the Leads sheet.</p></div>';
  MailApp.sendEmail({
    to: CONFIG.NOTIFY_EMAIL,
    subject: 'New consultation request from ' + f.name + (f.business ? ' (' + f.business + ')' : ''),
    htmlBody: html,
    body: rows.map(function (r) { return r[0] + ': ' + r[1]; }).join('\n'),
    replyTo: f.email,
    name: CONFIG.BUSINESS_NAME + ' Website'
  });
}

function confirmCustomer_(f) {
  const first = f.name.split(' ')[0];
  const html =
    '<div style="font-family:Arial,sans-serif;max-width:560px;color:#12222F;font-size:15px;line-height:1.6">' +
    '<p>Hi ' + esc_(first) + ',</p>' +
    '<p>Thanks for reaching out to Ikovex. We received your request and one of us will reply to you personally by email soon.</p>' +
    '<p style="margin:18px 0 6px;font-weight:bold">What you sent us</p>' +
    '<p style="background:#F3F4F1;border-left:4px solid #A61E2E;padding:12px 14px;white-space:pre-wrap;margin:0">' + esc_(f.message) + '</p>' +
    '<p style="margin-top:18px">Services: ' + esc_(f.services) + '</p>' +
    '<p>If anything changes, just reply to this email.</p>' +
    '<p>Imran and Syed<br><strong>Ikovex</strong><br><span style="color:#4E5F6D">Strong Systems. Trusted Support.</span></p></div>';
  MailApp.sendEmail({
    to: f.email,
    subject: 'We received your request | Ikovex',
    htmlBody: html,
    body: 'Hi ' + first + ',\n\nThanks for reaching out to Ikovex. We received your request and one of us will reply to you personally by email soon.\n\n' +
          'What you sent us:\n' + f.message + '\n\nServices: ' + f.services + '\n\nIf anything changes, just reply to this email.\n\nImran and Syed\nIkovex',
    replyTo: CONFIG.NOTIFY_EMAIL,
    name: CONFIG.BUSINESS_NAME
  });
}


/* ======================= helpers ======================= */

/* any value -> text, without invisible control characters (keeps normal line breaks) */
function text_(v) {
  if (v === null || v === undefined || typeof v === 'object') return '';
  return String(v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
}
/* single line text: line breaks and tabs become spaces (keeps email headers safe) */
function line_(v, max) { return text_(v).replace(/\s+/g, ' ').trim().slice(0, max); }
/* stops "formula injection": a value starting with = + - @ is stored as plain text, not run as a formula */
function safe_(v) { v = String(v || ''); return /^[=+\-@]/.test(v) ? "'" + v : v; }
function esc_(v) { return String(v || '').replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
/* short, fixed length cache key from any text */
function key_(prefix, s) { return prefix + '_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)); }
function shortErr_(err) { return String((err && err.message) || err).slice(0, 120); }
function fail_(field, message) { return json_({ ok: false, field: field, message: message }); }
function json_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }


/* ======================= tools you run from the editor ======================= */

/* STEP 1. Run once: approves permissions, creates the Leads tab, sends you a test email. */
function testSetup() {
  const sheet = getSheet_();
  sheet.appendRow([new Date(), 'Test Person', 'Test Business', CONFIG.NOTIFY_EMAIL, '', 'Web development',
    'This is a setup test. You can delete this row.', 'Test', 'setup', 'Spam', '']);
  notifyTeam_({ name: 'Test Person', business: 'Test Business', email: CONFIG.NOTIFY_EMAIL, phone: '', services: 'Web development',
    message: 'This is a setup test.', page: 'setup' }, 'Test');
  console.log('Setup OK. Check the Leads tab and your inbox. Emails left today: ' + MailApp.getRemainingDailyQuota());
}

/* STEP 2 (optional). Sends a full fake request through the real form code, exactly like the website does. */
function testFormSubmission() {
  const res = doPost({ postData: { contents: JSON.stringify({
    name: 'Form Test', business: 'Ikovex QA', email: CONFIG.NOTIFY_EMAIL, phone: '416-555-0199',
    services: 'IT support, Web development', message: 'Test request from testFormSubmission(). Mark as Spam or delete.',
    consent: true, page: 'editor test', _honey: '', _elapsed: 10000
  }) } });
  console.log('Result: ' + res.getContent());
}

/* STEP 3 (optional). Checks real email addresses against live DNS so you can see the checker working. */
function runLiveEmailTests() {
  const samples = ['someone@gmail.com', 'someone@outlook.com', 'someone@rogers.com', 'someone@yahoo.ca',
    'someone@gmial.com', 'someone@mailinator.com', 'someone@this-domain-does-not-exist-ikovex.ca', 'not-an-email'];
  samples.forEach(function (e) {
    const r = checkEmail_(e);
    console.log((r.ok ? 'ACCEPTED  ' : 'REJECTED  ') + e + '  ->  ' + (r.ok ? r.note : r.message));
  });
}
