import React, { createContext, useContext } from "react";

export const AuthContext = createContext({
  user: null,
  permissions: [],
  featureFlags: {}
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children, value }) {
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
