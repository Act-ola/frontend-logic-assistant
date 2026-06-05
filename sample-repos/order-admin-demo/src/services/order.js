import request from "../utils/request";

export function getOrderList(params) {
  return request.get("/api/orders", { params });
}

export function exportOrders(params) {
  return request.post("/api/orders/export", params);
}

export function getOrderDetail(orderId) {
  return request.get(`/api/orders/${orderId}`);
}
