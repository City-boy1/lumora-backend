const isProd = process.env.NODE_ENV === "production";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Sends one email through Brevo. Never throws; returns true when Brevo accepted it.
// With no Brevo settings (development only) it prints the message to the terminal instead.
async function sendMail({ to, subject, html, text, devNote = "" }) {
  const key = process.env.BREVO_API_KEY;
  const fromEmail = process.env.MAIL_FROM_EMAIL;

  if (!key || !fromEmail) {
    if (!isProd) {
      console.log(`\n[email not configured] To: ${to}\nSubject: ${subject}${devNote ? `\n${devNote}` : ""}\n`);
    } else {
      console.error("Email not sent: BREVO_API_KEY or MAIL_FROM_EMAIL is missing");
    }
    return false;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": key, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { name: process.env.MAIL_FROM_NAME || "Lumora", email: fromEmail },
        to: [{ email: to }],
        subject,
        htmlContent: html,
        textContent: text,
      }),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      console.error("Brevo rejected the email:", r.status, (await r.text()).slice(0, 200));
      return false;
    }
    return true;
  } catch (e) {
    console.error("Email failed:", e.message);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

const wrap = (inner) =>
  `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">${inner}<p style="color:#737373;font-size:12px;margin-top:32px">Lumora, a marketplace for Ghana.</p></div>`;

function resetEmail({ name, link, minutes }) {
  return {
    subject: "Reset your Lumora password",
    text: `Hi ${name || "there"},\n\nUse this link to choose a new password. It works once and expires in ${minutes} minutes:\n${link}\n\nIf you didn't ask for this, you can ignore this email. Your password won't change.`,
    html: wrap(
      `<h2 style="margin:0 0 12px">Reset your password</h2>
       <p>Hi ${esc(name || "there")},</p>
       <p>Use the button below to choose a new password. The link works once and expires in ${minutes} minutes.</p>
       <p><a href="${esc(link)}" style="display:inline-block;background:#111;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">Choose a new password</a></p>
       <p style="color:#737373;font-size:13px">If you didn't ask for this, ignore this email. Your password won't change.</p>`
    ),
  };
}

function changedEmail({ name }) {
  return {
    subject: "Your Lumora password was changed",
    text: `Hi ${name || "there"},\n\nYour password was just changed. If this was you, nothing more to do. If it wasn't, reset your password straight away and contact support.`,
    html: wrap(
      `<h2 style="margin:0 0 12px">Your password was changed</h2>
       <p>Hi ${esc(name || "there")},</p>
       <p>Your password was just changed. If this was you, there's nothing more to do.</p>
       <p><strong>If it wasn't you,</strong> reset your password straight away and contact support.</p>`
    ),
  };
}

function signupCodeEmail({ name, code, minutes }) {
  return {
    subject: `Your Lumora verification code: ${code}`,
    text: `Hi ${name || "there"},\n\nYour Lumora verification code is ${code}. It expires in ${minutes} minutes.\n\nIf you didn't try to create an account, ignore this email.`,
    html: wrap(
      `<h2 style="margin:0 0 12px">Confirm your email</h2>
       <p>Hi ${esc(name || "there")},</p>
       <p>Enter this code to finish creating your Lumora account. It expires in ${minutes} minutes.</p>
       <p style="font-size:34px;letter-spacing:8px;font-weight:bold;margin:16px 0">${esc(code)}</p>
       <p style="color:#737373;font-size:13px">If you didn't try to create an account, ignore this email.</p>`
    ),
  };
}

function verifyEmail({ name, link, hours }) {
  return {
    subject: "Verify your email for Lumora",
    text: `Hi ${name || "there"},\n\nWelcome to Lumora. Confirm your email address with this link. It works once and expires in ${hours} hours:\n${link}\n\nIf you didn't create an account, ignore this email.`,
    html: wrap(
      `<h2 style="margin:0 0 12px">Confirm your email</h2>
       <p>Hi ${esc(name || "there")},</p>
       <p>Welcome to Lumora. Confirm your email address to place orders and open a store. The link works once and expires in ${hours} hours.</p>
       <p><a href="${esc(link)}" style="display:inline-block;background:#111;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">Verify my email</a></p>
       <p style="color:#737373;font-size:13px">If you didn't create an account, ignore this email.</p>`
    ),
  };
}

module.exports = { sendMail, resetEmail, changedEmail, signupCodeEmail };