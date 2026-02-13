import sha512 from 'js-sha512';
import supabase from '../config/supabaseClient.js';

const EASEBUZZ_KEY = process.env.EASEBUZZ_KEY;
const EASEBUZZ_SALT = process.env.EASEBUZZ_SALT;
const EASEBUZZ_ENV = (process.env.EASEBUZZ_ENV || 'test').toLowerCase();
const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');

const EASEBUZZ_BASE_URL = EASEBUZZ_ENV === 'prod'
    ? 'https://pay.easebuzz.in'
    : 'https://testpay.easebuzz.in';

/**
 * Hash for Initiate Payment (never expose Salt to client).
 * Order: key|txnid|amount|productinfo|firstname|email|udf1..udf10|salt
 */
function generatePaymentHash(data, key, salt) {
    const udf = (i) => (data[`udf${i}`] != null ? String(data[`udf${i}`]).trim() : '');
    const hashstring = [
        key,
        data.txnid,
        data.amount,
        data.productinfo,
        data.firstname,
        data.email,
        udf(1), udf(2), udf(3), udf(4), udf(5),
        udf(6), udf(7), udf(8), udf(9), udf(10),
        salt
    ].join('|');
    return sha512.sha512(hashstring);
}

/**
 * Reverse hash for callback verification.
 * Order: salt|status|udf10|udf9|...|udf1|email|firstname|productinfo|amount|txnid|key
 */
function verifyCallbackHash(body, salt) {
    const udf = (i) => (body[`udf${i}`] != null ? String(body[`udf${i}`]).trim() : '');
    const hashstring = [
        salt,
        body.status || '',
        udf(10), udf(9), udf(8), udf(7), udf(6),
        udf(5), udf(4), udf(3), udf(2), udf(1),
        body.email || '',
        body.firstname || '',
        body.productinfo || '',
        body.amount || '',
        body.txnid || '',
        body.key || ''
    ].join('|');
    return sha512.sha512(hashstring);
}

/**
 * Create a real order from an order_drafts row (only called after payment success).
 */
async function createOrderFromDraft(draft) {
    const items = draft.items && Array.isArray(draft.items) ? draft.items : [];
    if (items.length === 0) return { order: null, error: 'No items in draft' };

    const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const todayStart = new Date().toISOString().split('T')[0];
    const { count, error: countError } = await supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', todayStart);

    if (countError) return { order: null, error: countError.message };

    const orderNumber = `GG-${today}-${String((count || 0) + 1).padStart(5, '0')}`;
    const orderData = {
        user_id: draft.user_id,
        order_number: orderNumber,
        address_id: draft.address_id,
        total_amount: Number(draft.total_amount) || 0,
        discount_amount: Number(draft.discount_amount) || 0,
        shipping_charges: Number(draft.shipping_charges) || 0,
        final_amount: Number(draft.final_amount),
        payment_method: 'easebuzz',
        payment_status: 'paid',
        order_status: 'pending',
        notes: null
    };

    const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert([orderData])
        .select()
        .single();

    if (orderError) return { order: null, error: orderError.message };

    const orderItems = items.map(item => ({
        order_id: order.id,
        product_id: item.product_id,
        product_name: item.product_name,
        product_price: item.product_price,
        quantity: item.quantity,
        subtotal: (item.product_price || 0) * (item.quantity || 0)
    }));

    const { error: itemsError } = await supabase
        .from('order_items')
        .insert(orderItems);

    if (itemsError) {
        await supabase.from('orders').delete().eq('id', order.id);
        return { order: null, error: itemsError.message };
    }

    return { order, error: null };
}

/**
 * POST /api/payment/initiate
 * Body: { user_id, address_id, items, total_amount, discount_amount, shipping_charges, final_amount, firstname, email, phone }
 * Saves draft (no order yet), gets Easebuzz payment link, returns payment_url.
 */
export const initiatePayment = async (req, res) => {
    try {
        if (!EASEBUZZ_KEY || !EASEBUZZ_SALT) {
            return res.status(500).json({
                success: false,
                message: 'Payment gateway is not configured'
            });
        }

        const {
            user_id,
            address_id,
            items,
            total_amount,
            discount_amount = 0,
            shipping_charges = 0,
            final_amount,
            firstname,
            email,
            phone
        } = req.body;

        if (!user_id || !address_id || !items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: user_id, address_id, items (array)'
            });
        }
        if (final_amount == null || !firstname || !email || !phone) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: final_amount, firstname, email, phone'
            });
        }

        const amountNum = Number(final_amount);
        const amountStr = amountNum.toFixed(2);

        const draftData = {
            user_id,
            address_id,
            items,
            total_amount: Number(total_amount) || 0,
            discount_amount: Number(discount_amount) || 0,
            shipping_charges: Number(shipping_charges) || 0,
            final_amount: amountNum,
            firstname: String(firstname).trim(),
            email: String(email).trim(),
            phone: String(phone).replace(/\D/g, '').slice(0, 10) || '0000000000'
        };

        const { data: draft, error: draftError } = await supabase
            .from('order_drafts')
            .insert([draftData])
            .select()
            .single();

        if (draftError) {
            return res.status(500).json({
                success: false,
                message: 'Failed to create payment session',
                error: draftError.message
            });
        }

        const txnid = String(draft.id);
        const udf1 = txnid;

        const callbackBase = `${req.protocol}://${req.get('host')}`;
        const surl = `${callbackBase}/api/payment/callback`;
        const furl = surl;

        const data = {
            key: EASEBUZZ_KEY,
            txnid,
            amount: amountStr,
            productinfo: `Order ${txnid.slice(0, 8)}`,
            firstname: draftData.firstname,
            email: draftData.email,
            phone: draftData.phone,
            surl,
            furl,
            udf1,
            udf2: '', udf3: '', udf4: '', udf5: '', udf6: '', udf7: '', udf8: '', udf9: '', udf10: ''
        };
        data.hash = generatePaymentHash(data, EASEBUZZ_KEY, EASEBUZZ_SALT);

        const formBody = new URLSearchParams();
        Object.keys(data).forEach(k => formBody.append(k, data[k]));

        const response = await fetch(`${EASEBUZZ_BASE_URL}/payment/initiateLink`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formBody.toString()
        });

        const result = await response.json().catch(() => ({}));
        const accessKey = (typeof result.data === 'string' ? result.data : null)
            || result.data?.access_key || result.access_key || result.accessKey;

        if (!accessKey) {
            return res.status(502).json({
                success: false,
                message: 'Could not get payment link',
                detail: result.message || result.error || 'Invalid response from payment gateway'
            });
        }

        const payment_url = `${EASEBUZZ_BASE_URL}/pay/${accessKey}`;

        return res.status(200).json({
            success: true,
            payment_url,
            access_key: accessKey
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: 'Payment initiation failed',
            error: error?.message || String(error)
        });
    }
};

/**
 * POST /api/payment/callback
 * Easebuzz POSTs here. Verify hash; only on success create order from draft and redirect to success.
 */
export const paymentCallback = async (req, res) => {
    try {
        const body = req.body || {};
        const receivedHash = body.hash;

        if (!receivedHash || !EASEBUZZ_SALT) {
            return res.redirect(302, `${FRONTEND_URL}/order-failed?reason=invalid_callback`);
        }

        const computedHash = verifyCallbackHash(body, EASEBUZZ_SALT);
        if (computedHash !== receivedHash) {
            return res.redirect(302, `${FRONTEND_URL}/order-failed?reason=hash_mismatch`);
        }

        const status = (body.status || '').toLowerCase();
        const draftId = body.udf1 || body.txnid;

        if (status === 'success' || status === 'captured') {
            if (!draftId) {
                return res.redirect(302, `${FRONTEND_URL}/order-failed?reason=no_draft`);
            }
            const { data: draft, error: fetchError } = await supabase
                .from('order_drafts')
                .select('*')
                .eq('id', draftId)
                .single();

            if (fetchError || !draft) {
                return res.redirect(302, `${FRONTEND_URL}/order-failed?reason=draft_not_found`);
            }

            const { order, error: createError } = await createOrderFromDraft(draft);
            if (createError || !order) {
                return res.redirect(302, `${FRONTEND_URL}/order-failed?reason=order_create_failed`);
            }

            await supabase.from('order_drafts').delete().eq('id', draftId);

            return res.redirect(302, `${FRONTEND_URL}/order-success?order_id=${order.id}`);
        }

        return res.redirect(302, `${FRONTEND_URL}/order-failed?draft_id=${draftId || ''}&reason=payment_failed`);
    } catch (error) {
        return res.redirect(302, `${FRONTEND_URL}/order-failed?reason=error`);
    }
};
