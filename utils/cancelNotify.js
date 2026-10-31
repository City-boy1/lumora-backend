const Notification = require("../models/notification");
const { REQUEST_AUTO_APPROVE_HOURS } = require("./cancelReasons");

const quiet = (p) => Promise.resolve(p).catch((e) => console.error("cancel notification failed:", e.message));

const base = (order) => ({ type: "order_update", isRead: false, relatedOrder: order._id });
const buyerLink = (order) => `/dashboard/orders?order=${order._id}`;
const sellerLink = (sub) => `/dashboard/sales?sub=${sub._id}`;

// Buyer asked to cancel a confirmed order -> tell the seller
exports.notifyCancelRequest = ({ order, sub }) =>
  quiet(
    Notification.create({
      ...base(order),
      recipient: sub.seller,
      title: "A buyer asked to cancel an order",
      message: `Order ${order.orderNumber}: the buyer asked to cancel (${sub.cancelRequest?.reason || "no reason"}). Please answer within ${REQUEST_AUTO_APPROVE_HOURS} hours or it is approved automatically.`,
      link: sellerLink(sub),
    })
  );

// outcome: "approved" | "refused" | "auto_approved"
exports.notifyCancelRequestAnswered = ({ order, sub, outcome, note }) => {
  const docs = [];
  const text = {
    approved: ["Your cancellation was approved", `The seller approved your request. Order ${order.orderNumber} is cancelled and you will be refunded.`],
    refused: ["Your cancellation request was refused", `The seller refused to cancel order ${order.orderNumber}. Reason: ${note || "none given"}. If something is wrong with it, you can report a problem after delivery.`],
    auto_approved: ["Your cancellation was approved", `The seller did not answer in ${REQUEST_AUTO_APPROVE_HOURS} hours, so order ${order.orderNumber} was cancelled and you will be refunded.`],
  }[outcome];
  docs.push({ ...base(order), recipient: sub.buyer, title: text[0], message: text[1], link: buyerLink(order) });
  if (outcome === "auto_approved") {
    docs.push({
      ...base(order),
      recipient: sub.seller,
      title: "An order was cancelled automatically",
      message: `Order ${order.orderNumber} was cancelled because you did not answer the buyer's request in time.`,
      link: sellerLink(sub),
    });
  }
  return quiet(Notification.insertMany(docs));
};

// Seller never confirmed a placed order
exports.notifyAutoCancelled = ({ order, sub }) =>
  quiet(
    Notification.insertMany([
      {
        ...base(order),
        recipient: sub.buyer,
        title: "Your order was cancelled",
        message: `The seller did not confirm order ${order.orderNumber} in time, so it was cancelled and you will be refunded.`,
        link: buyerLink(order),
      },
      {
        ...base(order),
        recipient: sub.seller,
        title: "An order was cancelled automatically",
        message: `Order ${order.orderNumber} was cancelled because it was not confirmed within 48 hours. This counts against your cancel rate.`,
        link: sellerLink(sub),
      },
    ])
  );