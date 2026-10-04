/**
 * QR Restaurant Feedback — Google Apps Script backend
 *
 * Guests scan a QR code on the table, rate their visit and the review
 * lands instantly in Google Sheets, where charts update automatically.
 */

// ─── CONFIG ────────────────────────────────────────────────────────────────
// ID of the Google Sheet that stores the reviews
// (the long string in the sheet URL: docs.google.com/spreadsheets/d/<SHEET_ID>/edit)
const SHEET_ID = 'YOUR_GOOGLE_SHEET_ID';

// Where low-rating alerts and the summary report are sent
const NOTIFICATION_EMAIL = 'you@example.com';

// Name shown in the page title, e-mails and the Drive photo folder
const VENUE_NAME = 'Cafe Central Linz';

// Time zone used for review timestamps
const TIME_ZONE = 'Europe/Vienna';
// ───────────────────────────────────────────────────────────────────────────

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(VENUE_NAME + ' - Feedback')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function isEmailConfigured_() {
  return NOTIFICATION_EMAIL && NOTIFICATION_EMAIL !== 'you@example.com';
}

function submitDetailedReview(ratings, comment, fileData, lang) {
  return processReview(ratings, comment, fileData, lang);
}

function processReview(ratings, comment, fileData, lang) {
  const timestamp = new Date();
  const cleanComment = comment && comment.trim() ? comment.trim() : '';
  const selectedLang = lang ? lang.toUpperCase() : 'DE';

  // .map(Number) makes sure form values (text "5") are summed as real numbers.
  const values = [ratings.service, ratings.food, ratings.drinks, ratings.atmosphere]
    .map(Number)
    .filter(v => v > 0);
  const overallRating = values.length > 0
    ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(1))
    : 0;

  // 1. Save optional photo to Google Drive
  let photoUrl = '';
  if (fileData) {
    try {
      const folderName = VENUE_NAME + ' Review Photos';
      const folders = DriveApp.getFoldersByName(folderName);
      const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);

      const decoded = Utilities.base64Decode(fileData.base64);
      const blob = Utilities.newBlob(decoded, fileData.type, fileData.name);
      const file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      photoUrl = file.getUrl();
    } catch (e) {
      Logger.log('Photo error: ' + e.toString());
    }
  }

  // 2. Smart tagging (keyword-based — no external API, free, no limits)
  let category = 'General';
  let sentiment = overallRating >= 4 ? 'Positive' : (overallRating <= 2 ? 'Negative' : 'Neutral');

  if (cleanComment.length > 0) {
    const result = analyzeComment(cleanComment);
    category = result.category;
    sentiment = result.sentiment;
  }

  // 3. Append row to the sheet
  if (SHEET_ID) {
    try {
      const sheet = SpreadsheetApp.openById(SHEET_ID).getActiveSheet();
      const formattedDate = Utilities.formatDate(timestamp, TIME_ZONE, 'dd.MM.yyyy HH:mm:ss');

      sheet.appendRow([
        formattedDate,
        overallRating,
        ratings.service || '-',
        ratings.food || '-',
        ratings.drinks || '-',
        ratings.atmosphere || '-',
        cleanComment || '(No comment)',
        photoUrl || '-',
        category,
        sentiment,
        selectedLang
      ]);
    } catch (e) {
      Logger.log('Sheet error: ' + e.toString());
    }
  }

  // 4. Instant alert for low ratings (<= 2 stars)
  if (overallRating <= 2 && isEmailConfigured_()) {
    try {
      MailApp.sendEmail({
        to: NOTIFICATION_EMAIL,
        subject: '⚠️ ' + VENUE_NAME + ': New low rating (' + overallRating + '★)',
        htmlBody: `
          <h3>Low rating alert</h3>
          <p><strong>Overall rating:</strong> ${overallRating} / 5</p>
          <p><strong>Comment:</strong> ${cleanComment || 'No comment'}</p>
          <p><strong>Category:</strong> ${category}</p>
          ${photoUrl ? `<p><strong>Photo:</strong> <a href="${photoUrl}">View photo</a></p>` : ''}
        `
      });
    } catch (e) {
      Logger.log('E-mail error: ' + e.toString());
    }
  }

  return { success: true };
}

/**
 * Lightweight multilingual (DE / EN / SK) keyword tagging.
 * Returns a topic category and a sentiment for the free-text comment.
 */
function analyzeComment(comment) {
  const text = comment.toLowerCase();
  const has = words => words.some(w => text.includes(w));
  let category = 'General';
  let sentiment = 'Neutral';

  if (has(['kellner', 'waiter', 'staff', 'obsluha', 'personal', 'freundlich'])) {
    category = 'Service & Staff';
  } else if (has(['essen', 'food', 'trinken', 'drink', 'kaffee', 'coffee', 'jedlo', 'kava'])) {
    category = 'Food & Drinks';
  } else if (has(['lange', 'wait', 'warten', 'pomal'])) {
    category = 'Wait Time';
  } else if (has(['teuer', 'price', 'preis', 'drah'])) {
    category = 'Pricing';
  } else if (has(['sauber', 'clean', 'musik', 'atmosfer', 'ambiente'])) {
    category = 'Atmosphere & Cleanliness';
  }

  if (has(['super', 'gut', 'great', 'top', 'danke', 'lecker', 'chutilo'])) {
    sentiment = 'Positive';
  } else if (has(['schlecht', 'bad', 'nie', 'katastrof', 'furchtbar'])) {
    sentiment = 'Negative';
  }

  return { category: category, sentiment: sentiment };
}

/**
 * Summary e-mail — attach a time-driven trigger (daily or weekly)
 * in Apps Script → Triggers.
 */
function sendWeeklyReport() {
  if (!isEmailConfigured_()) return;

  try {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getActiveSheet();
    const data = sheet.getDataRange().getValues();

    if (data.length <= 1) return;

    const reviewsCount = data.length - 1;
    let totalScore = 0;
    let positiveCount = 0;

    for (let i = 1; i < data.length; i++) {
      totalScore += Number(data[i][1]) || 0;
      if (data[i][9] === 'Positive') positiveCount++;
    }

    const avgScore = (totalScore / reviewsCount).toFixed(1);

    MailApp.sendEmail({
      to: NOTIFICATION_EMAIL,
      subject: '📊 ' + VENUE_NAME + ' - Feedback summary',
      htmlBody: `
        <h2>Guest feedback summary - ${VENUE_NAME}</h2>
        <p><strong>Total reviews:</strong> ${reviewsCount}</p>
        <p><strong>Average rating:</strong> ${avgScore} / 5 ⭐</p>
        <p><strong>Positive reviews:</strong> ${positiveCount} of ${reviewsCount}</p>
        <br>
        <p>Open the <a href="https://docs.google.com/spreadsheets/d/${SHEET_ID}">Google Sheets dashboard</a> for detailed charts.</p>
      `
    });
  } catch (e) {
    Logger.log('Report error: ' + e.toString());
  }
}
