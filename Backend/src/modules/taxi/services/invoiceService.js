import fs from 'node:fs';
import PDFDocument from 'pdfkit';
import { Ride } from '../user/models/Ride.js';
import { AdminBusinessSetting } from '../admin/models/AdminBusinessSetting.js';
import { getLandingContent } from '../admin/services/landingContentService.js';
import { sendEmail } from './mailService.js';
import { describeRidePayment, invoiceNumber } from './paymentLedgerService.js';

/**
 * Trip invoice PDF, emailed to the rider when a ride completes.
 *
 * Everything on the page is read at render time — company name, address, phone
 * and currency come from the admin panel (Landing CMS contact block and
 * business settings), the rest from the ride — so nothing here needs a deploy
 * to change.
 */

const PAGE_MARGIN = 48;
const INK = '#191713';
const MUTED = '#6B6660';
const RULE = '#DDD9D2';
const ACCENT = '#C8901F';

/**
 * pdfkit's built-in Helvetica is WinAnsi-encoded and has no glyph for the rupee
 * sign, which renders as a black box. If the host has a Unicode TTF we use it;
 * otherwise the amounts read "Rs." rather than shipping a broken glyph.
 */
const FONT_CANDIDATES = [
  ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'],
  ['/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'],
  ['C:/Windows/Fonts/arial.ttf', 'C:/Windows/Fonts/arialbd.ttf'],
];

const resolveFonts = () => {
  for (const [regular, bold] of FONT_CANDIDATES) {
    try {
      if (fs.existsSync(regular) && fs.existsSync(bold)) {
        return { regular, bold, unicode: true };
      }
    } catch {
      // unreadable path, try the next candidate
    }
  }
  return { regular: 'Helvetica', bold: 'Helvetica-Bold', unicode: false };
};

const FONTS = resolveFonts();

const money = (amount, symbol) => {
  const value = Number(amount || 0);
  const formatted = value.toLocaleString('en-IN', {
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `${symbol}${formatted}/-`;
};

const formatDate = (date) =>
  new Date(date || Date.now()).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });

/** The business's own details and currency, from the admin panel. */
const loadCompany = async () => {
  const [settingsDoc, landing] = await Promise.all([
    AdminBusinessSetting.findOne({ scope: 'default' }).select('general customization').lean(),
    getLandingContent().catch(() => null),
  ]);
  const general = settingsDoc?.general || {};
  const customization = settingsDoc?.customization || {};
  const contact = landing?.contact || {};
  const rawSymbol = String(customization.currency_symbol || '₹').trim() || '₹';
  return {
    symbol: FONTS.unicode ? rawSymbol : 'Rs. ',
    company: {
      name: String(general.app_name || 'Rideloo').trim(),
      tagline: String(contact.tagline || 'Reliable rides, simple journeys').trim(),
      address: String(contact.address || '').trim(),
      phone: String(contact.whatsappDisplay || general.contact_phone_1 || '').trim(),
      email: String(contact.email || '').trim(),
      city: String(contact.city || 'Bengaluru').trim(),
    },
  };
};

/** Everything the invoice prints, resolved from the ride and the admin panel. */
export const buildInvoiceModel = async ({ rideId }) => {
  const ride = await Ride.findById(rideId)
    .populate('userId', 'name email phone')
    .populate('driverId', 'name phone vehicleNumber')
    .lean();

  if (!ride) {
    throw new Error(`Ride ${rideId} not found`);
  }

  const [settingsDoc, landing] = await Promise.all([
    AdminBusinessSetting.findOne({ scope: 'default' }).select('general customization').lean(),
    getLandingContent().catch(() => null),
  ]);

  const general = settingsDoc?.general || {};
  const customization = settingsDoc?.customization || {};
  const contact = landing?.contact || {};

  const rawSymbol = String(customization.currency_symbol || '₹').trim() || '₹';
  // Fall back to an ASCII marker when we have no Unicode font to draw it with.
  const currencySymbol = FONTS.unicode ? rawSymbol : 'Rs. ';

  const fare = Number(ride.fare || 0);

  return {
    invoiceDate: formatDate(ride.completedAt || ride.updatedAt),
    company: {
      name: String(general.app_name || 'Rideloo').trim(),
      tagline: String(contact.tagline || 'Reliable rides, simple journeys').trim(),
      address: String(contact.address || '').trim(),
      phone: String(contact.whatsappDisplay || general.contact_phone_1 || '').trim(),
      email: String(contact.email || '').trim(),
      city: String(contact.city || 'Bengaluru').trim(),
    },
    trip: {
      customerName: String(ride.userId?.name || 'Customer').trim(),
      customerEmail: String(ride.userId?.email || '').trim(),
      driverName: String(ride.driverId?.name || '-').trim(),
      vehicleNumber: String(ride.driverId?.vehicleNumber || '-').trim(),
      pickup: String(ride.pickupAddress || '-').trim(),
      drop: String(ride.dropAddress || '-').trim(),
      paymentMethod: String(ride.paymentMethod || 'cash').trim(),
    },
    // How it was actually paid - a cash booking can be paid online at the end.
    payment: (() => {
      const paid = describeRidePayment(ride);
      return { detail: paid.detail, reference: paid.reference };
    })(),
    invoiceNumber: invoiceNumber('ride', ride._id),
    fare: {
      symbol: currencySymbol,
      tripFare: fare,
      total: fare,
    },
  };
};

const drawLabelledColumn = (doc, x, y, width, label, value) => {
  doc
    .font(FONTS.bold)
    .fontSize(7.5)
    .fillColor(MUTED)
    .text(label.toUpperCase(), x, y, { width, characterSpacing: 0.8 });

  doc
    .font(FONTS.regular)
    .fontSize(10.5)
    .fillColor(INK)
    .text(value || '-', x, y + 13, { width });
};

export const renderInvoicePdf = (model) =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = PAGE_MARGIN;
    const right = doc.page.width - PAGE_MARGIN;
    const width = right - left;

    // --- header -------------------------------------------------------------
    doc
      .font(FONTS.bold)
      .fontSize(20)
      .fillColor(INK)
      .text('TRIP INVOICE', left, PAGE_MARGIN, { characterSpacing: 1 });

    doc
      .font(FONTS.regular)
      .fontSize(10)
      .fillColor(MUTED)
      .text(model.invoiceDate, left, PAGE_MARGIN, { width, align: 'right' });
    if (model.invoiceNumber) {
      doc
        .font(FONTS.bold)
        .fontSize(9)
        .fillColor(INK)
        .text(`Invoice No. ${model.invoiceNumber}`, left, PAGE_MARGIN + 14, { width, align: 'right' });
    }

    let y = PAGE_MARGIN + 34;
    doc.moveTo(left, y).lineTo(right, y).lineWidth(2).strokeColor(INK).stroke();

    // --- company ------------------------------------------------------------
    y += 18;
    doc.font(FONTS.bold).fontSize(13).fillColor(INK).text(model.company.name, left, y);
    doc
      .font(FONTS.regular)
      .fontSize(9.5)
      .fillColor(ACCENT)
      .text(model.company.tagline, left, y + 17);

    y += 42;
    const colWidth = (width - 24) / 2;

    if (model.company.address) {
      drawLabelledColumn(doc, left, y, colWidth, 'Office Address', model.company.address);
    }
    if (model.company.phone) {
      drawLabelledColumn(doc, left + colWidth + 24, y, colWidth, 'Phone', model.company.phone);
    }

    y += 52;

    // --- trip details -------------------------------------------------------
    const sectionHeading = (text) => {
      doc
        .font(FONTS.bold)
        .fontSize(8.5)
        .fillColor(MUTED)
        .text(text.toUpperCase(), left, y, { characterSpacing: 1.2 });
      y += 14;
      doc.moveTo(left, y).lineTo(right, y).lineWidth(0.75).strokeColor(RULE).stroke();
      y += 14;
    };

    sectionHeading('Trip Details');

    const third = (width - 32) / 3;
    drawLabelledColumn(doc, left, y, third, 'Customer Name', model.trip.customerName);
    drawLabelledColumn(doc, left + third + 16, y, third, 'Driver Name', model.trip.driverName);
    drawLabelledColumn(doc, left + (third + 16) * 2, y, third, 'Vehicle Number', model.trip.vehicleNumber);

    y += 46;

    // --- journey ------------------------------------------------------------
    sectionHeading('Journey');

    const leg = (label, value) => {
      doc.circle(left + 3, y + 5, 3).fillColor(ACCENT).fill();
      doc
        .font(FONTS.bold)
        .fontSize(8)
        .fillColor(MUTED)
        .text(label.toUpperCase(), left + 14, y, { characterSpacing: 0.8 });
      const height = doc
        .font(FONTS.regular)
        .fontSize(10.5)
        .fillColor(INK)
        .heightOfString(value, { width: width - 14 });
      doc.text(value, left + 14, y + 12, { width: width - 14 });
      y += 12 + height + 12;
    };

    leg('Pickup', model.trip.pickup);
    leg('Drop', model.trip.drop);

    y += 4;

    // --- fare summary -------------------------------------------------------
    sectionHeading('Fare Summary');

    const amountX = right - 130;
    doc
      .font(FONTS.bold)
      .fontSize(8)
      .fillColor(MUTED)
      .text('DESCRIPTION', left, y)
      .text('AMOUNT', amountX, y, { width: 130, align: 'right' });

    y += 16;
    doc.moveTo(left, y).lineTo(right, y).lineWidth(0.75).strokeColor(RULE).stroke();
    y += 12;

    const row = (label, amount, bold = false) => {
      doc
        .font(bold ? FONTS.bold : FONTS.regular)
        .fontSize(10.5)
        .fillColor(INK)
        .text(label, left, y)
        .text(money(amount, model.fare.symbol), amountX, y, { width: 130, align: 'right' });
      y += 22;
    };

    row('Trip Fare', model.fare.tripFare);
    doc.moveTo(left, y - 6).lineTo(right, y - 6).lineWidth(0.75).strokeColor(RULE).stroke();
    row('Total Amount', model.fare.total, true);

    // --- total banner -------------------------------------------------------
    y += 8;
    doc.rect(left, y, width, 46).fillColor(INK).fill();
    doc
      .font(FONTS.bold)
      .fontSize(9)
      .fillColor('#FFFFFF')
      .text('TOTAL AMOUNT', left + 18, y + 17, { characterSpacing: 1.2 });
    doc
      .font(FONTS.bold)
      .fontSize(16)
      .fillColor('#FFFFFF')
      .text(money(model.fare.total, model.fare.symbol), left, y + 13, {
        width: width - 18,
        align: 'right',
      });

    y += 58;
    if (model.payment?.detail) {
      doc
        .font(FONTS.regular)
        .fontSize(9.5)
        .fillColor(MUTED)
        .text(`Payment: ${model.payment.detail}${model.payment.reference ? `  ·  Ref. ${model.payment.reference}` : ''}`, left, y, { width });
    }
    y += 16;

    // --- footer -------------------------------------------------------------
    doc
      .font(FONTS.bold)
      .fontSize(10.5)
      .fillColor(INK)
      .text(`Thank you for choosing ${model.company.name}.`, left, y, { width, align: 'center' });
    doc
      .font(FONTS.regular)
      .fontSize(9.5)
      .fillColor(MUTED)
      .text('We appreciate your business and wish you a safe journey.', left, y + 16, {
        width,
        align: 'center',
      });

    const footerY = doc.page.height - PAGE_MARGIN - 28;
    doc.moveTo(left, footerY).lineTo(right, footerY).lineWidth(0.75).strokeColor(RULE).stroke();
    doc
      .font(FONTS.bold)
      .fontSize(9)
      .fillColor(INK)
      .text(model.company.name, left, footerY + 10);
    doc
      .font(FONTS.regular)
      .fontSize(9)
      .fillColor(MUTED)
      .text(model.company.city, left, footerY + 10, { width, align: 'right' });

    doc.end();
  });

export const buildRideInvoicePdf = async ({ rideId }) => {
  const model = await buildInvoiceModel({ rideId });
  const buffer = await renderInvoicePdf(model);
  const stamp = model.invoiceDate.replace(/\s+/g, '_');
  const slug = model.company.name.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'Invoice';

  return { buffer, model, filename: `${slug}_Trip_Invoice_${stamp}.pdf` };
};

/**
 * Emails the invoice to the rider. Never throws: a mail or PDF problem must not
 * fail the ride completion that triggered it, so failures are logged and
 * reported in the return value instead.
 */
export const sendRideInvoiceEmail = async ({ rideId }) => {
  try {
    const { buffer, model, filename } = await buildRideInvoicePdf({ rideId });
    const to = model.trip.customerEmail;

    if (!to) {
      return { sent: false, reason: 'no-customer-email' };
    }

    const total = money(model.fare.total, model.fare.symbol);
    const result = await sendEmail({
      to,
      subject: `Your ${model.company.name} trip invoice — ${model.invoiceDate}`,
      text: [
        `Hi ${model.trip.customerName},`,
        '',
        `Thank you for riding with ${model.company.name}.`,
        `Your invoice for ${model.invoiceDate} is attached.`,
        '',
        `Pickup: ${model.trip.pickup}`,
        `Drop:   ${model.trip.drop}`,
        `Total:  ${total}`,
        '',
        'We appreciate your business and wish you a safe journey.',
        model.company.name,
      ].join('\n'),
      html: `
        <div style="font-family:Arial,Helvetica,sans-serif;color:#191713;line-height:1.6">
          <p>Hi ${model.trip.customerName},</p>
          <p>Thank you for riding with <strong>${model.company.name}</strong>.
             Your invoice for ${model.invoiceDate} is attached as a PDF.</p>
          <table style="border-collapse:collapse;margin:16px 0">
            <tr><td style="padding:4px 16px 4px 0;color:#6B6660">Pickup</td><td>${model.trip.pickup}</td></tr>
            <tr><td style="padding:4px 16px 4px 0;color:#6B6660">Drop</td><td>${model.trip.drop}</td></tr>
            <tr><td style="padding:4px 16px 4px 0;color:#6B6660">Total</td><td><strong>${total}</strong></td></tr>
          </table>
          <p style="color:#6B6660">We appreciate your business and wish you a safe journey.</p>
          <p><strong>${model.company.name}</strong></p>
        </div>`,
      attachments: [{ filename, content: buffer, contentType: 'application/pdf' }],
    });

    if (result?.skipped) {
      return { sent: false, reason: result.reason };
    }

    return { sent: true, to, filename };
  } catch (error) {
    console.error('[invoice] failed to send ride invoice:', error.message);
    return { sent: false, reason: 'error', message: error.message };
  }
};

/**
 * Receipt for a payment that is not a ride - a driver's subscription pass or a
 * wallet top-up - in the same style as the trip invoice. [payment] is a row
 * from paymentLedgerService.
 */
export const renderPaymentReceiptPdf = (payment, { company, symbol }) =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = PAGE_MARGIN;
    const right = doc.page.width - PAGE_MARGIN;
    const width = right - left;

    doc.font(FONTS.bold).fontSize(20).fillColor(INK).text('PAYMENT RECEIPT', left, PAGE_MARGIN, { characterSpacing: 1 });
    doc.font(FONTS.regular).fontSize(10).fillColor(MUTED).text(formatDate(payment.date), left, PAGE_MARGIN, { width, align: 'right' });
    doc.font(FONTS.bold).fontSize(9).fillColor(INK).text(`Receipt No. ${payment.invoice_number}`, left, PAGE_MARGIN + 14, { width, align: 'right' });

    let y = PAGE_MARGIN + 34;
    doc.moveTo(left, y).lineTo(right, y).lineWidth(2).strokeColor(INK).stroke();

    y += 18;
    doc.font(FONTS.bold).fontSize(13).fillColor(INK).text(company.name, left, y);
    doc.font(FONTS.regular).fontSize(9.5).fillColor(ACCENT).text(company.tagline, left, y + 17);
    y += 42;
    const colWidth = (width - 24) / 2;
    if (company.address) drawLabelledColumn(doc, left, y, colWidth, 'Office Address', company.address);
    if (company.phone) drawLabelledColumn(doc, left + colWidth + 24, y, colWidth, 'Phone', company.phone);
    y += 52;

    const sectionHeading = (text) => {
      doc.font(FONTS.bold).fontSize(8.5).fillColor(MUTED).text(text.toUpperCase(), left, y, { characterSpacing: 1.2 });
      y += 14;
      doc.moveTo(left, y).lineTo(right, y).lineWidth(0.75).strokeColor(RULE).stroke();
      y += 14;
    };

    sectionHeading('Received From');
    drawLabelledColumn(doc, left, y, colWidth, payment.payer.role === 'driver' ? 'Driver' : 'Rider', payment.payer.name);
    drawLabelledColumn(doc, left + colWidth + 24, y, colWidth, 'Phone', payment.payer.phone || '-');
    y += 46;

    sectionHeading('Payment');
    const amountX = right - 130;
    doc.font(FONTS.bold).fontSize(8).fillColor(MUTED).text('DESCRIPTION', left, y).text('AMOUNT', amountX, y, { width: 130, align: 'right' });
    y += 16;
    doc.moveTo(left, y).lineTo(right, y).lineWidth(0.75).strokeColor(RULE).stroke();
    y += 12;
    doc
      .font(FONTS.regular)
      .fontSize(10.5)
      .fillColor(INK)
      .text(`${payment.kind_label} - ${payment.description}`, left, y, { width: amountX - left - 12 })
      .text(money(payment.amount, symbol), amountX, y, { width: 130, align: 'right' });
    y += 30;

    doc.rect(left, y, width, 46).fillColor(INK).fill();
    doc.font(FONTS.bold).fontSize(9).fillColor('#FFFFFF').text('AMOUNT PAID', left + 18, y + 17, { characterSpacing: 1.2 });
    doc.font(FONTS.bold).fontSize(16).fillColor('#FFFFFF').text(money(payment.amount, symbol), left, y + 13, { width: width - 18, align: 'right' });
    y += 62;

    doc
      .font(FONTS.regular)
      .fontSize(9.5)
      .fillColor(MUTED)
      .text(`Payment: ${payment.detail}${payment.reference ? `  ·  Ref. ${payment.reference}` : ''}`, left, y, { width });
    y += 30;
    doc.font(FONTS.bold).fontSize(10.5).fillColor(INK).text(`Thank you for choosing ${company.name}.`, left, y, { width, align: 'center' });

    const footerY = doc.page.height - PAGE_MARGIN - 28;
    doc.moveTo(left, footerY).lineTo(right, footerY).lineWidth(0.75).strokeColor(RULE).stroke();
    doc.font(FONTS.bold).fontSize(9).fillColor(INK).text(company.name, left, footerY + 10);
    doc.font(FONTS.regular).fontSize(9).fillColor(MUTED).text(company.city, left, footerY + 10, { width, align: 'right' });
    doc.end();
  });

/// Invoice PDF for any row of the payments ledger: the trip invoice for a ride,
/// a receipt for everything else.
export const buildPaymentInvoicePdf = async (payment) => {
  if (payment.kind === 'ride') {
    const { buffer, filename } = await buildRideInvoicePdf({ rideId: payment.record_id });
    return { buffer, filename: filename.replace('.pdf', `_${payment.invoice_number}.pdf`) };
  }
  const company = await loadCompany();
  const buffer = await renderPaymentReceiptPdf(payment, company);
  const slug = company.company.name.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'Receipt';
  return { buffer, filename: `${slug}_Receipt_${payment.invoice_number}.pdf` };
};
