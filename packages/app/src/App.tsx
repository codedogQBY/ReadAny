/**
 * App — React Router configuration
 */
import { BrowserRouter, Routes, Route } from "react-router";
import { AppLayout } from "@/components/layout/AppLayout";
import Home from "@/pages/Home";
import Reader from "@/pages/Reader";
import Chat from "@/pages/Chat";
import Notes from "@/pages/Notes";

export default function App() {
  return (
    <BrowserRouter>
      <AppLayout>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/reader/:bookId" element={<Reader />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/notes" element={<Notes />} />
        </Routes>
      </AppLayout>
    </BrowserRouter>
  );
}
