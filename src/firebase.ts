import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyCGQVVlUHyZZU7UoZaqXYkNyIsN0utk2yA",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "roka-crm-c437f.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "roka-crm-c437f",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "roka-crm-c437f.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "108262759441",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:108262759441:web:250663bb12c7211a10e5b0",
};

export const firebaseApp = initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(firebaseApp);
export const googleProvider = new GoogleAuthProvider();
