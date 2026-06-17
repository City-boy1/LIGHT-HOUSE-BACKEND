const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT),
  secure: false, // TLS via STARTTLS
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const FROM = process.env.SMTP_FROM || 'Lighthouse Chapel <iamkojo4@gmail.com>';
const ADMIN_EMAIL = process.env.SMTP_USER;

// ── Base HTML wrapper ───────────────────────────────────────
function htmlWrap(title, content) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f0f2f8;font-family:'Lato',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f8;padding:40px 20px">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
        <!-- Header -->
        <tr><td style="background:#081a35;padding:28px 36px;border-radius:12px 12px 0 0;text-align:center">
          <div style="font-size:1.4rem;color:#b89240;letter-spacing:3px;font-weight:700">✦ LIGHTHOUSE CHAPEL</div>
          <div style="font-size:0.75rem;color:rgba(255,255,255,0.5);letter-spacing:2px;margin-top:4px">THE QUODESH FAMILY CHURCH</div>
        </td></tr>
        <!-- Title bar -->
        <tr><td style="background:#143d6f;padding:16px 36px">
          <div style="font-size:1rem;color:#fff;font-weight:700;letter-spacing:1px">${title}</div>
        </td></tr>
        <!-- Body -->
        <tr><td style="background:#ffffff;padding:32px 36px;border-radius:0 0 12px 12px">
          ${content}
          <hr style="border:none;border-top:1px solid #e0e4f0;margin:28px 0"/>
          <p style="color:#aaa;font-size:0.75rem;text-align:center;margin:0">
            Lighthouse Chapel · Amasaman, Accra, Ghana<br/>
            This is an automated message — please do not reply directly.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function field(label, value) {
  if (!value) return '';
  return `<tr>
    <td style="padding:8px 0;color:#888;font-size:0.82rem;width:140px;vertical-align:top">${label}</td>
    <td style="padding:8px 0;color:#1a1a2e;font-size:0.9rem;vertical-align:top">${value}</td>
  </tr>`;
}

function table(rows) {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:20px">${rows}</table>`;
}

// ── Send helper ─────────────────────────────────────────────
async function sendMail({ to, subject, html }) {
  try {
    await transporter.sendMail({ from: FROM, to, subject, html });
    console.log(`[mailer] Sent "${subject}" → ${to}`);
  } catch (err) {
    console.error(`[mailer] Failed to send "${subject}":`, err.message);
  }
}

// ════════════════════════════════════════════════════════════
// EMAIL TEMPLATES
// ════════════════════════════════════════════════════════════

// 1. New prayer request → admin
async function notifyNewPrayerRequest(prayer) {
  const html = htmlWrap('🙏 New Prayer Request', `
    <p style="color:#555;margin-bottom:20px">A new prayer request has been submitted and needs your attention.</p>
    ${table(
      field('Name', prayer.requester_name) +
      field('Email', prayer.email) +
      field('Phone', prayer.phone) +
      field('Visibility', prayer.is_private ? '🔒 Private' : '🌐 Public')
    )}
    <div style="background:#f8f6f2;border-left:4px solid #b89240;padding:16px 20px;border-radius:0 8px 8px 0;color:#333;font-size:0.9rem;line-height:1.6">
      ${prayer.request_text}
    </div>
    <div style="margin-top:24px;text-align:center">
      <a href="${process.env.FRONTEND_URL}/admin/dashboard.html" style="background:#143d6f;color:#fff;padding:12px 28px;border-radius:50px;text-decoration:none;font-size:0.85rem;font-weight:700">View in Dashboard</a>
    </div>
  `);
  await sendMail({ to: ADMIN_EMAIL, subject: '🙏 New Prayer Request — Lighthouse Chapel', html });
}

// 2. New contact message → admin
async function notifyNewContactMessage(msg) {
  const html = htmlWrap('✉️ New Contact Message', `
    <p style="color:#555;margin-bottom:20px">Someone has sent a message through the website contact form.</p>
    ${table(
      field('Name', msg.name) +
      field('Email', msg.email) +
      field('Phone', msg.phone) +
      field('Subject', msg.subject)
    )}
    <div style="background:#f8f6f2;border-left:4px solid #b89240;padding:16px 20px;border-radius:0 8px 8px 0;color:#333;font-size:0.9rem;line-height:1.6">
      ${msg.message}
    </div>
    <div style="margin-top:24px;text-align:center">
      <a href="${process.env.FRONTEND_URL}/admin/dashboard.html" style="background:#143d6f;color:#fff;padding:12px 28px;border-radius:50px;text-decoration:none;font-size:0.85rem;font-weight:700">View in Dashboard</a>
    </div>
  `);
  await sendMail({ to: ADMIN_EMAIL, subject: `✉️ New Message: ${msg.subject || 'Contact Form'} — Lighthouse Chapel`, html });
}

// 3. Welcome email → new member
async function sendMemberWelcome(member) {
  if (!member.email) return;
  const html = htmlWrap('Welcome to Lighthouse Chapel! 🎉', `
    <p style="color:#333;font-size:1rem;margin-bottom:8px">Dear <strong>${member.full_name}</strong>,</p>
    <p style="color:#555;line-height:1.7;margin-bottom:20px">
      We are overjoyed to welcome you to the Lighthouse Chapel family — The Quodesh Family Church.
      You are now part of something special, and we look forward to growing together in faith.
    </p>
    ${table(
      field('Primary Group', member.primary_group) +
      field('Member Since', member.join_date ? new Date(member.join_date).toLocaleDateString('en-GH', { year:'numeric', month:'long', day:'numeric' }) : null)
    )}
    <p style="color:#555;line-height:1.7;margin-bottom:20px">
      Join us every Sunday as we worship together. If you have any questions or need
      assistance, please don't hesitate to reach out to us.
    </p>
    <p style="color:#555;line-height:1.7">
      We are glad you are here. God bless you! 🙏
    </p>
    <p style="color:#333;margin-top:20px"><strong>Lighthouse Chapel Leadership</strong><br/>
    <span style="color:#888;font-size:0.85rem">Amasaman, Accra, Ghana</span></p>
  `);
  await sendMail({ to: member.email, subject: 'Welcome to Lighthouse Chapel! 🎉', html });
}

// 4. Prayer marked answered → member (if email provided)
async function notifyPrayerAnswered(prayer) {
  if (!prayer.email) return;
  const html = htmlWrap('Your Prayer Has Been Answered 🙏', `
    <p style="color:#333;font-size:1rem;margin-bottom:8px">Dear <strong>${prayer.requester_name}</strong>,</p>
    <p style="color:#555;line-height:1.7;margin-bottom:20px">
      We are rejoicing with you! Your prayer request has been marked as answered by our pastoral team.
      We give all glory to God for His faithfulness.
    </p>
    <div style="background:#f8f6f2;border-left:4px solid #27ae60;padding:16px 20px;border-radius:0 8px 8px 0;color:#333;font-size:0.9rem;line-height:1.6;margin-bottom:20px">
      ${prayer.request_text}
    </div>
    <p style="color:#555;line-height:1.7">
      Thank you for trusting us with your prayer. We continue to stand with you in faith.
    </p>
    <p style="color:#333;margin-top:20px"><strong>Lighthouse Chapel Leadership</strong><br/>
    <span style="color:#888;font-size:0.85rem">Amasaman, Accra, Ghana</span></p>
  `);
  await sendMail({ to: prayer.email, subject: '🙏 Your Prayer Has Been Answered — Lighthouse Chapel', html });
}

// 5. New event registration → admin
async function notifyNewRegistration({ registration, form }) {
  const html = htmlWrap('📋 New Event Registration', `
    <p style="color:#555;margin-bottom:20px">A new registration has been submitted for <strong>${form.event_title}</strong>.</p>
    ${table(
      field('Name', registration.respondent_name) +
      field('Email', registration.respondent_email) +
      field('Phone', registration.respondent_phone) +
      field('Reference', registration.payment_reference) +
      field('Payment', form.show_payment_info ? '⏳ Awaiting confirmation' : 'N/A')
    )}
    <div style="margin-top:24px;text-align:center">
      <a href="${process.env.FRONTEND_URL}/admin/dashboard.html" style="background:#143d6f;color:#fff;padding:12px 28px;border-radius:50px;text-decoration:none;font-size:0.85rem;font-weight:700">View in Dashboard</a>
    </div>
  `);
  await sendMail({ to: ADMIN_EMAIL, subject: `📋 New Registration: ${form.event_title}`, html });
}

// 6. Registration confirmation → registrant
async function sendRegistrationConfirmation({ registration, form, fields }) {
  if (!registration.respondent_email) return;

  const paymentBlock = form.show_payment_info ? `
    <div style="background:#fff8e1;border:2px solid #b89240;border-radius:10px;padding:20px;margin:20px 0">
      <div style="font-size:1rem;font-weight:700;color:#0d2b52;margin-bottom:12px">💳 Payment Required</div>
      ${table(
        field('Amount', form.payment_amount ? `GHS ${parseFloat(form.payment_amount).toFixed(2)}` : null) +
        field('Payment Provider', form.momo_provider || 'Mobile Money') +
      field('Recipient Number', form.mtn_number) +
        field('Reference', registration.payment_reference)
      )}
      <p style="color:#555;font-size:0.85rem;margin-top:8px">
        <strong>Important:</strong> Use your reference number <strong>${registration.payment_reference}</strong> 
        as the payment description/reference when sending money. This helps us match your payment.
      </p>
      ${form.payment_instructions ? `<p style="color:#555;font-size:0.85rem;margin-top:8px">${form.payment_instructions}</p>` : ''}
    </div>` : '';

  const html = htmlWrap(`Registration Confirmed — ${form.event_title}`, `
    <p style="color:#333;font-size:1rem;margin-bottom:8px">Dear <strong>${registration.respondent_name}</strong>,</p>
    <p style="color:#555;line-height:1.7;margin-bottom:20px">
      Your registration for <strong>${form.event_title}</strong> has been received successfully.
    </p>
    ${table(
      field('Reference Number', registration.payment_reference) +
      field('Event Date', form.event_date ? new Date(form.event_date).toLocaleDateString('en-GH', { weekday:'long', year:'numeric', month:'long', day:'numeric' }) : null) +
      field('Location', form.location)
    )}
    ${paymentBlock}
    <p style="color:#555;line-height:1.7;margin-top:20px">
      Please keep your reference number safe. You may need it at the event entrance.
    </p>
    <p style="color:#333;margin-top:24px"><strong>Lighthouse Chapel Leadership</strong><br/>
    <span style="color:#888;font-size:0.85rem">Amasaman, Accra, Ghana</span></p>
  `);

  await sendMail({
    to: registration.respondent_email,
    subject: `✅ Registration Confirmed — ${form.event_title}`,
    html
  });
}

module.exports = {
  notifyNewPrayerRequest,
  notifyNewContactMessage,
  sendMemberWelcome,
  notifyPrayerAnswered,
  notifyNewRegistration,
  sendRegistrationConfirmation,
};