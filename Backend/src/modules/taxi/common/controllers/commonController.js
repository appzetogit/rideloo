import { asyncHandler } from '../../../../utils/asyncHandler.js';
import { uploadDataUrl } from '../../../../utils/fileUpload.js';
import { env } from '../../../../config/env.js';
import { getReferralSettings, getReferralTranslationContent } from '../../admin/services/adminService.js';
import { getPublicActivePaymentGateway } from '../../services/paymentGatewayService.js';
import { buildPaymentRequestContext, logPaymentDiagnostic } from '../../services/paymentDiagnostics.js';
import {
    isValidCashfreeWebhookSignature,
    settleCashfreeWalletOrder,
} from '../../services/cashfreeSettlementService.js';

/**
 * Common controller for shared utilities like file uploads
 */
export const uploadImage = asyncHandler(async (req, res) => {
    const { image, folder = 'general' } = req.body;
    
    if (!image) {
        return res.status(400).json({ success: false, message: 'Image data is required' });
    }

    const uploadResult = await uploadDataUrl({
        dataUrl: image,
        folder: `${env.uploads.folder}/${folder}`,
        publicIdPrefix: `content-${folder}`
    });

    return res.json({
        success: true,
        data: {
            url: uploadResult.secureUrl,
            publicId: uploadResult.publicId,
            format: uploadResult.format
        }
    });
});

export const getReferralTranslation = asyncHandler(async (req, res) => {
    const languageCode = String(req.query?.language || req.query?.lang || '').trim().toLowerCase();
    const data = await getReferralTranslationContent(languageCode);

    return res.json({
        success: true,
        data,
    });
});

export const getReferralSettingsContent = asyncHandler(async (req, res) => {
    const type = String(req.query?.type || '').trim().toLowerCase();
    const data = await getReferralSettings(type || undefined);

    return res.json({
        success: true,
        data,
    });
});

export const getPaymentGatewayConfig = asyncHandler(async (_req, res) => {
    const data = await getPublicActivePaymentGateway();

    return res.json({
        success: true,
        data,
    });
});

// Cashfree payment webhook (order_meta.notify_url). Credits a wallet top-up
// even when the app was closed before it could call verify. The payload is
// only a hint: the order is read back from Cashfree before anything is paid
// out, and ride payments are left to their own verify calls.
export const handleCashfreeWebhook = asyncHandler(async (req, res) => {
    const valid = await isValidCashfreeWebhookSignature({
        rawBody: req.rawBody,
        timestamp: req.get('x-webhook-timestamp'),
        signature: req.get('x-webhook-signature'),
    }).catch(() => false);

    if (!valid) {
        return res.status(401).json({ success: false, message: 'Invalid signature' });
    }

    const orderId = String(req.body?.data?.order?.order_id || '').trim();
    const type = String(req.body?.type || '');
    let outcome = 'ignored';

    if (orderId && /^(uwalcf|dwalcf)_/.test(orderId)) {
        try {
            const settlement = await settleCashfreeWalletOrder({ orderId });
            outcome = settlement.credited ? 'credited' : settlement.paid ? 'already_credited' : `status_${settlement.status}`;
        } catch (error) {
            outcome = `error: ${error?.message || error}`;
        }
    }

    logPaymentDiagnostic({
        provider: 'cashfree',
        scope: 'webhook',
        stage: outcome,
        request: buildPaymentRequestContext(req),
        body: { type, orderId },
    });

    // 200 for anything signed, so Cashfree stops retrying events we skip.
    return res.json({ success: true, outcome });
});

export const acknowledgePhonePeCallback = asyncHandler(async (req, res) => {
    logPaymentDiagnostic({
        provider: 'phonepe',
        scope: 'callback',
        stage: 'received',
        request: buildPaymentRequestContext(req),
        query: req.query || {},
        body: req.body || {},
    });

    return res.json({
        success: true,
        message: 'Callback received',
    });
});

export const acknowledgeRechargeApiCallback = asyncHandler(async (req, res) => {
    return res.json({
        success: true,
        message: 'Recharge API callback received',
        data: {
            query: req.query || {},
            body: req.body || {},
            receivedAt: new Date().toISOString(),
        },
    });
});
