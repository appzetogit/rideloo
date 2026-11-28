// Cashfree web checkout (JS SDK v3). The backend creates the order and returns
// its payment_session_id; this opens Cashfree's checkout for it. Whatever the
// checkout reports, the caller must still call its verify API: only the
// server's check of the order status decides whether the payment counts.

const CASHFREE_SDK_URL = 'https://sdk.cashfree.com/js/v3/cashfree.js';

const loadCashfreeSdk = () =>
  new Promise((resolve) => {
    if (window.Cashfree) {
      resolve(true);
      return;
    }
    const script = document.createElement('script');
    script.src = CASHFREE_SDK_URL;
    script.async = true;
    script.onload = () => resolve(Boolean(window.Cashfree));
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });

/**
 * Open checkout for a Cashfree order and wait until the customer is done.
 * Resolves to { closedWithError: string|null }.
 */
export const openCashfreeCheckout = async ({ paymentSessionId, isProduction }) => {
  if (!paymentSessionId) {
    throw new Error('Unable to start payment');
  }
  const loaded = await loadCashfreeSdk();
  if (!loaded) {
    throw new Error('Cashfree checkout failed to load');
  }
  const cashfree = window.Cashfree({ mode: isProduction ? 'production' : 'sandbox' });
  const result = await cashfree.checkout({ paymentSessionId, redirectTarget: '_modal' });
  return { closedWithError: result?.error?.message || null };
};
