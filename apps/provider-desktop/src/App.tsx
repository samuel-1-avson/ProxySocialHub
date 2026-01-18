import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthLayout } from "./layouts/AuthLayout";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import "./App.css";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AuthLayout />}>
          <Route path="/login" element={<Login />} />
        </Route>

        <Route path="/dashboard" element={<Dashboard />} />

        {/* Redirect root to dashboard (which redirects to login if unauth) */}
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
