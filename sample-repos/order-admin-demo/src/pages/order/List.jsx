import React, { useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react-lite";
import { useAuth } from "../../context/AuthContext";
import { exportOrders, getOrderList } from "../../services/order";
import { orderStore } from "../../stores/orderStore";

function OrderList() {
  const { user, permissions, featureFlags } = useAuth();
  const [keyword, setKeyword] = useState("");
  const [selectedRows, setSelectedRows] = useState([]);
  const [mobileVisible, setMobileVisible] = useState(false);

  const canExport =
    permissions.includes("order.export") &&
    featureFlags.orderExport !== false &&
    orderStore.currentTab !== "archived";

  const canSeeMobile = permissions.includes("customer.mobile.read") && user?.role !== "outsourcer";

  const exportDisabled = orderStore.loading || orderStore.list.length === 0 || selectedRows.length === 0;

  useEffect(() => {
    orderStore.loading = true;
    getOrderList({ keyword, tab: orderStore.currentTab }).then((res) => {
      orderStore.setList(res.list);
      orderStore.loading = false;
    });
  }, [keyword, orderStore.currentTab]);

  const visibleOrders = useMemo(() => {
    return orderStore.list.filter((order) => order.status !== "deleted");
  }, [orderStore.list]);

  function handleExport() {
    return exportOrders({
      ids: selectedRows.map((row) => row.id),
      keyword
    });
  }

  if (!user) {
    return null;
  }

  return (
    <section>
      <header>
        <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索订单" />
        {canExport && (
          <button disabled={exportDisabled} onClick={handleExport}>
            导出
          </button>
        )}
      </header>

      {visibleOrders.map((order) => (
        <article key={order.id}>
          <strong>{order.name}</strong>
          {canSeeMobile ? <span>{order.mobile}</span> : <span>手机号不可见</span>}
          {mobileVisible && <button onClick={() => setMobileVisible(false)}>隐藏手机号</button>}
        </article>
      ))}
    </section>
  );
}

export default observer(OrderList);
