import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from './firebase';
import { collection, query, getDocs } from 'firebase/firestore';
import './leaderboards.css';

export default function Leaderboards() {
    const [players, setPlayers] = useState([]);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();

    useEffect(() => {
        const fetchPlayers = async () => {
            try {
                const usersQuery = query(collection(db, 'users'));
                const snapshot = await getDocs(usersQuery);
                const playersData = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));
                setPlayers(playersData);
                setLoading(false);
            } catch (error) {
                console.error('Error fetching players:', error);
                setLoading(false);
            }
        };

        fetchPlayers();
    }, []);

    const getSortedPlayers = (gameType) => {
        return [...players].sort((a, b) => {
            const aElo = a.stats?.[gameType] || 1000;
            const bElo = b.stats?.[gameType] || 1000;
            return bElo - aElo;
        });
    };

    if (loading) {
        return <div className="leaderboards-loading">Loading leaderboards...</div>;
    }

    return (
        <div className="leaderboards-container">
            <div className="leaderboards-header">
                <button
                    className="back-button"
                    onClick={() => navigate('/')}
                >
                    ← Back to Home
                </button>
                <h1>Global Leaderboards</h1>
            </div>

            <div className="leaderboards-grid">
                {/* Shoot The Target Leaderboard */}
                <div className="leaderboard-column">
                    <h2>🎯 Shoot The Target</h2>
                    <div className="leaderboard-list">
                        {getSortedPlayers('sttElo').map((player, index) => (
                            <div key={player.id} className="player-rank">
                                <span className={`rank ${index < 3 ? 'top-3' : ''}`}>#{index + 1}</span>
                                <span className="username">{player.username}</span>
                                <span className="elo">{player.stats?.sttElo || 1000}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* UNO Leaderboard */}
                <div className="leaderboard-column">
                    <h2>🎴 UNO</h2>
                    <div className="leaderboard-list">
                        {getSortedPlayers('unoElo').map((player, index) => (
                            <div key={player.id} className="player-rank">
                                <span className={`rank ${index < 3 ? 'top-3' : ''}`}>#{index + 1}</span>
                                <span className="username">{player.username}</span>
                                <span className="elo">{player.stats?.unoElo || 1000}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Age of Wars Leaderboard */}
                <div className="leaderboard-column">
                    <h2>⚔️ Age of Wars</h2>
                    <div className="leaderboard-list">
                        {getSortedPlayers('aowElo').map((player, index) => (
                            <div key={player.id} className="player-rank">
                                <span className={`rank ${index < 3 ? 'top-3' : ''}`}>#{index + 1}</span>
                                <span className="username">{player.username}</span>
                                <span className="elo">{player.stats?.aowElo || 1000}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}