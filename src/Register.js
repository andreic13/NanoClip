import { useState } from 'react';
import { createUserWithEmailAndPassword, sendEmailVerification } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from './firebase';
import { useNavigate } from 'react-router-dom';
import './Auth.css';

export default function Register() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [username, setUsername] = useState('');
    const [error, setError] = useState('');
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        try {
            // 1. Register user with Firebase Auth
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);

            // 1 b.  Send the confirmation mail
            await sendEmailVerification(userCredential.user, {
                // Optional: after they click the link, Firebase will open this URL
                url: `${window.location.origin}/login`
            });

            // (Totally optional) show a toast / modal:
            alert('We’ve sent a confirmation link to ' + email + '.\nPlease verify your e-mail before logging in.');

            const uid = userCredential.user.uid;

            // 2. Create Firestore user document
            await setDoc(doc(db, 'users', uid), {
                username,
                email,
                isGuest: false,
                avatarUrl: '', // Optional: you can let users set this later
                stats: {
                    sttElo: 1000,
                    unoElo: 1000,
                    aowElo: 1000
                },
                createdAt: serverTimestamp(),
                lastOnline: serverTimestamp()
            });

            navigate('/login');
        } catch (err) {
            setError(err.message);
        }
    };

    return (
        <div className="auth-container">
            <h2>Register</h2>
            {error && <div className="error-message">{error}</div>}
            <form onSubmit={handleSubmit}>
                <input
                    type="text"
                    placeholder="Username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                />
                <input
                    type="email"
                    placeholder="Email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                />
                <input
                    type="password"
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength="6"
                />
                <button type="submit">Register</button>
            </form>
            <p>
                Already have an account? <a href="/login">Login</a>
            </p>
        </div>
    );
}
