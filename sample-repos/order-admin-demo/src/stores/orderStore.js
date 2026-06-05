import { makeAutoObservable } from "mobx";

export class OrderStore {
  list = [];
  loading = false;
  currentTab = "active";

  constructor() {
    makeAutoObservable(this);
  }

  setList(list) {
    this.list = list;
  }
}

export const orderStore = new OrderStore();
