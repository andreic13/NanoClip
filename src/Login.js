import { useState } from 'react';
import { signInWithEmailAndPassword, sendEmailVerification, signOut } from 'firebase/auth';
import { useNavigate } from 'react-router-dom';
import { auth, db } from './firebase';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import './Auth.css';

export default function Login() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        try {
            const userCredential = await signInWithEmailAndPassword(auth, email, password);

            // Check if the user needs to verify their email
            if (!userCredential.user.emailVerified) {
                await sendEmailVerification(userCredential.user, {
                    url: `${window.location.origin}/login`
                });
                alert('We’ve sent a confirmation link to ' + email + '.\nPlease verify your e-mail before logging in.');
                await signOut(auth);
                return;
            }

            const uid = userCredential.user.uid;
            const userRef = doc(db, 'users', uid);
            const userSnap = await getDoc(userRef);

            if (userSnap.exists()) {
                const data = userSnap.data();
                const updates = {};

                // Patch missing fields with defaults
                if (data.isGuest === undefined) updates.isGuest = false;
                if (!data.stats) {
                    updates.stats = { sttElo: 1000, unoElo: 1000, aowElo: 1000 };
                }
                if (!data.avatarUrl) updates.avatarUrl = '';
                updates.lastOnline = serverTimestamp();

                if (Object.keys(updates).length > 0) {
                    await updateDoc(userRef, updates);
                }
            }

            navigate('/');
        } catch (err) {
            setError(err.message);
        }
    };

    const handleGuestAccess = () => {
        localStorage.setItem('isGuest', 'true');
        navigate('/');
    };

    return (
        <div className="auth-container">
            <h2>Login</h2>
            {error && <div className="error-message">{error}</div>}
            <form onSubmit={handleSubmit}>
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
                />
                <button type="submit">Login</button>
                <p>
                    Or you can choose to:
                </p>
                <button onClick={handleGuestAccess} className="guest-button">
                    Enter as Guest
                </button>
            </form>
            <p>
                Don't have an account yet? <a href="/register">Register</a>
            </p>
        </div>
    );
}
