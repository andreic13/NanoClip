import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Home from './Home';
import Login from './Login';
import Register from './Register';
import Profile from './Profile';
import ShootTheTargetGame from './Games/shoot_the_target/shoot_the_target';
import AgeOfWarsGame from './Games/age_of_wars/age_of_wars';
import UnoGame from './Games/UNO/uno';
import Players from './Players';
import Lobbies from './Lobbies';
import LobbyRoom from './LobbyRoom';
import Leaderboards from './leaderboards';
import { AuthProvider } from './AuthContext'; // import the context provider

function App() {
    return (
        <AuthProvider>
            <Router>
                <Routes>
                    <Route path="/" element={<Home />} />
                    <Route path="/login" element={<Login />} />
                    <Route path="/register" element={<Register />} />
                    <Route path="/Games/shoot_the_target/shoot_the_target" element={<ShootTheTargetGame />} />
                    <Route path="/Games/age_of_wars/age_of_wars" element={<AgeOfWarsGame />} />
                    <Route path="/Games/UNO/uno" element={<UnoGame />} />
                    <Route path="/Profile" element={<Profile />} />
                    <Route path="/Players" element={<Players />} />
                    <Route path="/lobbies" element={<Lobbies />} />
                    <Route path="/lobby/:lobbyId" element={<LobbyRoom />} />
                    <Route path="/leaderboards" element={<Leaderboards />} />
                </Routes>
            </Router>
        </AuthProvider>
    );
}

export default App;