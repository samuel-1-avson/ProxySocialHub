import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./lib/auth";
import { AuthLayout } from "./layouts/AuthLayout";
import { MainLayout } from "./layouts/MainLayout";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { Feed } from "./pages/Feed";
import { Marketplace } from "./pages/Marketplace";
import { Wallet } from "./pages/Wallet";
import "./App.css";

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Auth Routes */}
          <Route element={<AuthLayout />}>
            <Route path="/login" element={<Login />} />
          </Route>

          {/* Protected Routes */}
          <Route element={<MainLayout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/feed" element={<Feed />} />
            <Route path="/marketplace" element={<Marketplace />} />
            <Route path="/wallet" element={<Wallet />} />
            {/* These will be ported in future iterations if needed */}
            <Route path="/node" element={<div className="font-mono uppercase p-12 text-center h-full flex flex-col items-center justify-center opacity-30"><div className="text-4xl mb-4 font-black">MODULE_UNDER_CONSTRUCTION</div><div className="text-xs tracking-widest uppercase">Encryption protocols currently being synchronized.</div></div>} />
            <Route path="/agents" element={<div className="font-mono uppercase p-12 text-center h-full flex flex-col items-center justify-center opacity-30"><div className="text-4xl mb-4 font-black">AI_LAYER_OFFLINE</div><div className="text-xs tracking-widest uppercase">Neural network interface undergoing maintenance.</div></div>} />
            <Route path="/messages" element={<div className="font-mono uppercase p-12 text-center h-full flex flex-col items-center justify-center opacity-30"><div className="text-4xl mb-4 font-black">COMMS_ENCRYPTED</div><div className="text-xs tracking-widest uppercase">Decryption keys required for access.</div></div>} />
            <Route path="/forum" element={<div className="font-mono uppercase p-12 text-center h-full flex flex-col items-center justify-center opacity-30"><div className="text-4xl mb-4 font-black">ARCHIVE_LOCKED</div><div className="text-xs tracking-widest uppercase">Knowledge base indexing in progress.</div></div>} />
          </Route>

          {/* Redirect root to dashboard */}
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
