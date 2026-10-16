# Connect the website form to Google Sheets and Gmail

About 10 minutes, no coding. When you finish, every consultation request will:

1. Be saved as a new row in a Google Sheet called **Ikovex Leads**
2. Arrive in **ikovex.support@gmail.com** (press Reply to answer the customer directly)
3. Send the customer a short "we received your request" confirmation email

> This `_setup` folder is not published on the website. GitHub Pages skips folders that start with an underscore, so it is safe to upload it with everything else.

---

## Step 1. Create the sheet

1. Sign in to Google as **ikovex.support@gmail.com**. This matters: emails are sent from whichever account owns the script.
2. Go to **sheets.new** to create a blank sheet.
3. Rename it **Ikovex Leads** (click "Untitled spreadsheet" at the top left).

## Step 2. Add the script

1. In the sheet, open **Extensions → Apps Script**.
2. Delete everything in the editor.
3. Open `_setup/Code.gs` from this folder, copy all of it, and paste it into the editor.
4. Click the **Save** icon (the floppy disk).

## Step 3. Approve it once

1. In the toolbar dropdown next to **Run**, choose **testSetup**, then click **Run**.
2. Google asks for permission. Click **Review permissions** and choose ikovex.support@gmail.com.
3. You will see "Google hasn't verified this app". This is normal for a script you wrote yourself. Click **Advanced**, then **Go to Untitled project (unsafe)**, then **Allow**.
4. Check that it worked:
   - The sheet now has a **Leads** tab with a header row and one test row.
   - Your inbox has a "New consultation request from Test Person" email.
5. Optional checks, each run the same way from the dropdown:
   - **testFormSubmission** sends a full fake request through the real form code. You get a new row, a team email and a confirmation email.
   - **runLiveEmailTests** checks real addresses against live DNS and lists the results under **Execution log**. For example, someone@gmail.com is ACCEPTED and someone@gmial.com is REJECTED.
6. Set your time zone so times in the sheet are correct: in the sheet, open **File → Settings** and choose **(GMT-05:00) Eastern Time - Toronto**.

## Step 4. Publish it as a web app

1. Click **Deploy → New deployment**.
2. Click the gear icon next to "Select type" and choose **Web app**.
3. Fill it in exactly like this:
   - **Description:** Ikovex website form
   - **Execute as:** Me (ikovex.support@gmail.com)
   - **Who has access:** Anyone
4. Click **Deploy**.
5. Copy the **Web app URL**. It looks like `https://script.google.com/macros/s/AKfy.../exec`.

"Anyone" only means the website can send requests to it. Nobody can read your sheet through this link.

## Step 5. Connect the website

1. Open `assets/site.js`.
2. Find this line near the top:
   ```
   sheetEndpoint: '',
   ```
3. Paste your URL between the quotes:
   ```
   sheetEndpoint: 'https://script.google.com/macros/s/AKfy.../exec',
   ```
4. Save, then upload the updated `assets/site.js` to GitHub.

## Step 6. Test it

1. Open the live site and send a request using your own personal email.
2. Within a minute you should see:
   - a new row in the Leads sheet
   - the request in ikovex.support@gmail.com
   - the confirmation email in your personal inbox
3. In the sheet, set the **Status** column of the test row to "Spam", or delete the row.

---

## Everyday use

- **Notes column:** Stays empty unless something went wrong, for example "Confirmation email not sent" when the daily email limit is reached. The lead itself is always saved.
- **Spam log tab:** Requests blocked as spam are listed here instead of disappearing, so you can check that nothing real was blocked. It stops at 1,000 rows.
- **Status column:** Each new request comes in as "New". Use the dropdown to track it: Replied, Call booked, Quote sent, Won, Lost or Spam.
- **Phone alerts:** In Google Sheets, open **Tools → Notification settings → Edit notifications** to get an email whenever the sheet changes. The Gmail app already alerts you for each request.
- **Turn off the customer confirmation email:** In the script, change `SEND_CONFIRMATION: true` to `false`.

## If you change the script later

Use **Deploy → Manage deployments**, click the pencil icon, set **Version** to **New version**, and click **Deploy**. This keeps the same URL, so the website keeps working. If you use "New deployment" instead, you get a new URL and must paste it into `site.js` again.

## How email checking works

Every email address is checked twice: once in the browser, so the visitor sees the problem straight away, and again by the script, because browser checks can be bypassed. The checks are:

| Check | Example it stops |
|---|---|
| Proper format | `jordan`, `jordan@gmail`, `jordan..lee@gmail.com` |
| Common typos, with a one tap fix | `jordan@gmial.com` becomes "Did you mean jordan@gmail.com?" |
| Throwaway inboxes | `x@mailinator.com`, `x@10minutemail.com` |
| The domain really accepts email (MX record) | `jordan@shopp-not-real.ca` |

**One honest limit:** no website can confirm that a specific inbox exists without sending it an email. `asdfgh@gmail.com` passes every check, because gmail.com is real. That is why the script sends every customer a confirmation email. If an address is fake, Gmail sends you a "delivery failed" notice, and you can mark that row as Spam.

## Limits

- **Email limit:** A free Gmail account can send about 100 emails a day through Apps Script. Each request uses two (your copy and the customer's confirmation), so roughly 50 requests a day. Your leads are always saved to the sheet even if the email limit is reached.
- **Built in spam protection:** a hidden trap field, a 4 second minimum fill time, a link filter, at most 3 requests per email address per hour, and at most 20 requests per minute in total.
