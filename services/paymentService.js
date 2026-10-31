// Simulated payments. Paystack later: start as "pending", become "paid" only
// through a server-verified webhook. Never trust a browser redirect.
async function startPayment({ orderId, amount, method, network, momoNumber }) {
  return {
    provider: "simulated",
    method,
    network: network || "",
    momoLast4: momoNumber ? String(momoNumber).slice(-4) : "",
    status: "paid",
    reference: `SIM-${orderId}`,
    paidAt: new Date(),
    amount,
    currency: "GHS",
  };
}

async function confirmPayment(reference) {
  return { reference, status: "paid" };
}

module.exports = { startPayment, confirmPayment };