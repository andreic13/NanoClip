import { useEffect, useState, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { database, ref, set, onValue, update, remove } from "../../firebase";
import { auth, db } from '../../firebase';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import './uno.css';

export default function UnoGame() {
    const location = useLocation();
    const navigate = useNavigate();
    const { lobbyId, players: lobbyPlayers, isHost, isSpectator } = location.state || {};

    // Use current user ID instead of random playerId
    const [playerId] = useState(() => auth.currentUser?.uid || null);

    const [gameState, setGameState] = useState({
        players: [],
        currentPlayer: 0,
        direction: 1,
        topCard: null,
        deck: [],
        playerHands: {},
        gameOver: false,
        winner: null,
        wildColor: null,
        status: 'waiting'
    });

    const [status, setStatus] = useState('waiting');
    const [usernames, setUsernames] = useState({});
    const [selectedCardIndex, setSelectedCardIndex] = useState(null);
    const [showColorPicker, setShowColorPicker] = useState(false);
    const [pendingWildCard, setPendingWildCard] = useState(null);

    const colors = ['Red', 'Yellow', 'Green', 'Blue'];
    const numbers = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
    const specials = ['Skip', 'Rev', '+2'];

    const BASE_ELO_CHANGE = 20;
    const navigateTimeoutRef = useRef(null);

    // Initialize game
    useEffect(() => {
        if (!lobbyId || !auth.currentUser) {
            navigate('/');
            return;
        }

        // Fetch usernames for all players
        const fetchUsernames = async () => {
            const usernamesMap = {};
            for (const playerId of lobbyPlayers) {
                try {
                    const userDoc = await getDoc(doc(db, 'users', playerId));
                    if (userDoc.exists()) {
                        usernamesMap[playerId] = userDoc.data().username || userDoc.data().email || 'Unknown Player';
                    } else {
                        usernamesMap[playerId] = 'Unknown Player';
                    }
                } catch (error) {
                    console.error('Error fetching username for', playerId, error);
                    usernamesMap[playerId] = 'Unknown Player';
                }
            }
            setUsernames(usernamesMap);
            return usernamesMap;
        };

        fetchUsernames();

        // Initialize game state (only for host)
        const initializeGame = async () => {
            if (!isHost) return;

            try {
                // Wait for usernames to be fetched
                const usernamesMap = await fetchUsernames();

                const deck = createDeck();
                const hands = {};

                // Deal 7 cards to each player
                lobbyPlayers.forEach(playerId => {
                    hands[playerId] = deck.splice(0, 7);
                });

                // Get initial top card (not wild or special)
                let topCard;
                do {
                    topCard = deck.shift();
                } while (topCard.color === 'Wild' || specials.includes(topCard.value));

                const initialGameState = {
                    players: lobbyPlayers.map((playerId, index) => ({
                        id: playerId,
                        number: index,
                        username: usernamesMap[playerId] || 'Loading...' // Use the fetched usernames
                    })),
                    currentPlayer: 0,
                    direction: 1,
                    topCard: topCard,
                    deck: deck,
                    playerHands: hands,
                    gameOver: false,
                    winner: null,
                    wildColor: null,
                    status: 'playing' // Set status to playing
                };

                console.log('Initializing game with state:', initialGameState);
                await set(ref(database, `games/uno/${lobbyId}`), initialGameState);
            } catch (error) {
                console.error('Error initializing game:', error);
            }
        };

        initializeGame();

        // Listen to game state
        const gameRef = ref(database, `games/uno/${lobbyId}`);
        const unsubscribe = onValue(gameRef, async (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.val();
                setGameState(data);
                setStatus(data.status);

                if (data.gameOver) {
                    setStatus('gameOver');

                    // Update ELO if not spectator
                    if (!isSpectator && auth.currentUser) {
                        // Sort players by their card count (less cards = better position)
                        const sortedPlayers = [...data.players].sort((a, b) => {
                            const aCards = data.playerHands[a.id]?.length || 0;
                            const bCards = data.playerHands[b.id]?.length || 0;
                            return aCards - bCards;
                        });

                        const myPosition = sortedPlayers.findIndex(p => p.id === auth.currentUser.uid) + 1;
                        const eloChange = calculateEloChange(myPosition, sortedPlayers.length);

                        try {
                            const userRef = doc(db, 'users', auth.currentUser.uid);
                            const userDoc = await getDoc(userRef);

                            if (userDoc.exists()) {
                                const userData = userDoc.data();
                                const currentStats = userData.stats || {};
                                const currentElo = currentStats.unoElo || 1000;

                                await updateDoc(userRef, {
                                    'stats.unoElo': currentElo + eloChange
                                });
                            } else {
                                await setDoc(userRef, {
                                    stats: {
                                        unoElo: 1000 + eloChange
                                    }
                                });
                            }
                        } catch (error) {
                            console.error('Error updating ELO:', error);
                        }
                    }

                    // Navigate home after 10 seconds
                    if (!navigateTimeoutRef.current) {
                        navigateTimeoutRef.current = setTimeout(() => {
                            navigate('/');
                        }, 10000);
                    }
                }
            }
        });

        return () => {
            unsubscribe();
            if (navigateTimeoutRef.current) {
                clearTimeout(navigateTimeoutRef.current);
            }
        };
    }, [lobbyId, lobbyPlayers, isHost, navigate, isSpectator]);

    const calculateEloChange = (position, totalPlayers) => {
        const isTopHalf = position <= Math.floor(totalPlayers / 2);
        const positionMultiplier = 1 - ((position - 1) / totalPlayers); // 1st place = 1, last place = 0
        const eloChange = Math.round(BASE_ELO_CHANGE * positionMultiplier);
        return isTopHalf ? eloChange : -eloChange;
    };

    const createDeck = () => {
        const deck = [];

        // Add colored cards
        for (const color of colors) {
            // Add number cards (0 has 1 copy, others have 2)
            for (const number of numbers) {
                deck.push({ color, value: number });
                if (number !== '0') deck.push({ color, value: number });
            }
            // Add special cards (2 copies each)
            for (const special of specials) {
                deck.push({ color, value: special });
                deck.push({ color, value: special });
            }
        }

        // Add Wild cards (4 of each)
        for (let i = 0; i < 4; i++) {
            deck.push({ color: 'Wild', value: 'Wild' });
            deck.push({ color: 'Wild', value: '+4' });
        }

        return shuffleDeck(deck);
    };

    const shuffleDeck = (deck) => {
        const shuffled = [...deck];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    };

    const canPlayCard = (card, topCard) => {
        // Wild cards can always be played
        if (card.color === 'Wild') {
            return true;
        }

        // If top card is wild, check against the chosen color
        if (topCard.color === 'Wild' && gameState.wildColor) {
            return card.color === gameState.wildColor || card.value === topCard.value;
        }

        return card.color === topCard.color || card.value === topCard.value;
    };

    const getNextPlayer = () => {
        let nextPlayer = gameState.currentPlayer + gameState.direction;

        if (nextPlayer >= gameState.players.length) {
            nextPlayer = 0;
        } else if (nextPlayer < 0) {
            nextPlayer = gameState.players.length - 1;
        }

        return nextPlayer;
    };

    const isMyTurn = () => {
        if (!auth.currentUser || isSpectator) return false;
        const myPlayerIndex = gameState.players.findIndex(p => p.id === auth.currentUser.uid);
        return myPlayerIndex === gameState.currentPlayer;
    };

    const chooseWildColor = async (color, cardIndex, cardValue) => {
        try {
            const myHand = gameState.playerHands[playerId] || [];
            const newHand = [...myHand];
            newHand.splice(cardIndex, 1);
            let newDeck = [...gameState.deck];

            let updates = {
                topCard: { color: 'Wild', value: cardValue },
                [`playerHands/${playerId}`]: newHand,
                wildColor: color,
                deck: newDeck
            };

            // Check for win condition
            if (newHand.length === 0) {
                updates.gameOver = true;
                updates.winner = gameState.players[gameState.currentPlayer];
            } else {
                // Handle Wild Draw Four
                if (cardValue === '+4') {
                    const nextPlayerIndex = getNextPlayer();
                    const nextPlayerId = gameState.players[nextPlayerIndex].id;
                    const nextPlayerHand = [...(gameState.playerHands[nextPlayerId] || [])];

                    // Draw 4 cards for next player
                    for (let i = 0; i < 4 && newDeck.length > 0; i++) {
                        nextPlayerHand.push(newDeck.shift());
                    }

                    updates[`playerHands/${nextPlayerId}`] = nextPlayerHand;
                    updates.deck = newDeck;

                    // Next player loses turn
                    let skipToPlayer = nextPlayerIndex + gameState.direction;
                    if (skipToPlayer >= gameState.players.length) {
                        skipToPlayer = 0;
                    } else if (skipToPlayer < 0) {
                        skipToPlayer = gameState.players.length - 1;
                    }
                    updates.currentPlayer = skipToPlayer;
                } else {
                    // Regular Wild - move to next player
                    updates.currentPlayer = getNextPlayer();
                }
            }

            await update(ref(database, `games/uno/${lobbyId}`), updates); // Use lobbyId instead of gameId
            setSelectedCardIndex(null);
            setShowColorPicker(false);
            setPendingWildCard(null);

        } catch (error) {
            console.error('Error playing wild card:', error);
        }
    };

    const playCard = async (cardIndex) => {
        if (!isMyTurn() || gameState.gameOver || isSpectator) return;

        const myHand = gameState.playerHands[playerId] || [];
        const card = myHand[cardIndex];

        if (!canPlayCard(card, gameState.topCard)) {
            alert('Cannot play this card!');
            return;
        }

        // Handle Wild cards - show color picker
        if (card.color === 'Wild') {
            setPendingWildCard({ cardIndex, cardValue: card.value });
            setShowColorPicker(true);
            return;
        }

        try {
            const newHand = [...myHand];
            newHand.splice(cardIndex, 1);
            let newDeck = [...gameState.deck];

            let updates = {
                topCard: card,
                [`playerHands/${playerId}`]: newHand,
                wildColor: null,
                deck: newDeck
            };

            // Check for win condition
            if (newHand.length === 0) {
                updates.gameOver = true;
                updates.winner = gameState.players[gameState.currentPlayer];
            } else {
                // Handle special cards
                if (card.value === 'Skip') {
                    // Skip next player
                    let nextPlayer = getNextPlayer(); // player to be skipped
                    nextPlayer = nextPlayer + gameState.direction; // player who will actually play
                    if (nextPlayer >= gameState.players.length) {
                        nextPlayer = 0;
                    } else if (nextPlayer < 0) {
                        nextPlayer = gameState.players.length - 1;
                    }
                    updates.currentPlayer = nextPlayer;

                } else if (card.value === 'Rev') {
                    // Change direction
                    const newDirection = gameState.direction * -1;
                    updates.direction = newDirection;

                    // Calculate next player with new direction
                    let nextPlayer = gameState.currentPlayer + newDirection;
                    if (nextPlayer >= gameState.players.length) {
                        nextPlayer = 0;
                    } else if (nextPlayer < 0) {
                        nextPlayer = gameState.players.length - 1;
                    }
                    updates.currentPlayer = nextPlayer;

                } else if (card.value === '+2') {
                    // Next player draws 2 cards and loses turn
                    const nextPlayerIndex = getNextPlayer();
                    const nextPlayerId = gameState.players[nextPlayerIndex].id;
                    const nextPlayerHand = [...(gameState.playerHands[nextPlayerId] || [])];

                    // Draw 2 cards for next player
                    for (let i = 0; i < 2 && newDeck.length > 0; i++) {
                        nextPlayerHand.push(newDeck.shift());
                    }

                    updates[`playerHands/${nextPlayerId}`] = nextPlayerHand;
                    updates.deck = newDeck;

                    // Next player loses turn
                    let skipToPlayer = nextPlayerIndex + gameState.direction;
                    if (skipToPlayer >= gameState.players.length) {
                        skipToPlayer = 0;
                    } else if (skipToPlayer < 0) {
                        skipToPlayer = gameState.players.length - 1;
                    }
                    updates.currentPlayer = skipToPlayer;

                } else {
                    // Regular card - move to next player
                    updates.currentPlayer = getNextPlayer();
                }
            }

            await update(ref(database, `games/uno/${lobbyId}`), updates); // Use lobbyId instead of gameId
            setSelectedCardIndex(null);

        } catch (error) {
            console.error('Error playing card:', error);
        }
    };

    const drawCard = async () => {
        if (!isMyTurn() || gameState.gameOver || gameState.deck.length === 0 || isSpectator) return;

        try {
            const newDeck = [...gameState.deck];
            const drawnCard = newDeck.shift();
            const myHand = [...(gameState.playerHands[playerId] || [])];
            myHand.push(drawnCard);

            const nextPlayer = getNextPlayer();

            const updates = {
                deck: newDeck,
                [`playerHands/${playerId}`]: myHand,
                currentPlayer: nextPlayer
            };

            await update(ref(database, `games/uno/${lobbyId}`), updates); // Use lobbyId instead of gameId

        } catch (error) {
            console.error('Error drawing card:', error);
        }
    };

    const getCardColor = (color) => {
        if (color === 'Wild') return 'wild';
        return color.toLowerCase();
    };

    const getDisplayColor = (topCard) => {
        if (topCard.color === 'Wild' && gameState.wildColor) {
            return gameState.wildColor;
        }
        return topCard.color;
    };

    const displayHand = isSpectator
        ? (gameState.playerHands?.[gameState.players[gameState.currentPlayer]?.id] || [])
        : (gameState.playerHands?.[playerId] || []);

    return (
        <div className="uno-container">
            <div className="game-board fade-in">
                <div className="uno-title">
                    <h1>
                        <span className="letter-u">U</span>
                        <span className="letter-n">N</span>
                        <span className="letter-o">O</span>
                    </h1>
                    <div className="game-status">
                        {status === 'waiting' && 'Waiting for game to start...'}
                        {status === 'playing' && (
                            <div>
                                {isSpectator ? (
                                    <div>👀 Spectating</div>
                                ) : (
                                    <div>{isMyTurn() ? 'YOUR TURN' : 'WAITING...'}</div>
                                )}
                                <div>Current Player: {usernames[gameState.players[gameState.currentPlayer]?.id] || 'Unknown'}</div>
                            </div>
                        )}
                        {status === 'gameOver' && `Game Over! Winner: ${gameState.winner?.username}`}
                    </div>
                </div>

                <div className="players-info">
                    {gameState.players.map((player) => (
                        <div key={player.id} className={`player-info ${player.number === gameState.currentPlayer ? 'active' : ''}`}>
                            <div className="player-name">{usernames[player.id] || 'Loading...'}</div>
                            <div>{gameState.playerHands?.[player.id]?.length || 0} cards</div>
                        </div>
                    ))}
                </div>

                <div className="game-center">
                    <div className="text-center">
                        <div
                            className={`deck card${isSpectator ? ' spectator' : ''}`}
                            onClick={drawCard}
                        >
                            <span>UNO</span>
                        </div>
                        <div>Draw ({gameState.deck?.length || 0})</div>
                    </div>

                    {gameState.topCard && (
                        <div className="text-center">
                            <div className={`card ${getCardColor(getDisplayColor(gameState.topCard))}`}>
                                <div className="card-value">{gameState.topCard.value}</div>
                            </div>
                            <div>Top Card</div>
                            {gameState.wildColor && (
                                <div>Color: {gameState.wildColor}</div>
                            )}
                        </div>
                    )}

                    <div className="text-center">
                        <div className="direction">
                            {gameState.direction === 1 ? '⟳' : '⟲'}
                        </div>
                        <div>Direction</div>
                    </div>
                </div>

                <div className="player-hand">
                    {displayHand.map((card, index) => (
                        <div
                            key={index}
                            className={`card ${getCardColor(card.color)}
                            ${selectedCardIndex === index ? ' selected' : ''}
                            ${!isSpectator && canPlayCard(card, gameState.topCard) && isMyTurn() ? ' playable' : ''}
                            ${isSpectator ? ' spectator' : ''}`}
                            onClick={() => {
                                if (isSpectator) return;
                                if (isMyTurn() && canPlayCard(card, gameState.topCard)) {
                                    playCard(index);
                                } else {
                                    setSelectedCardIndex(index === selectedCardIndex ? null : index);
                                }
                            }}
                        >
                            <div className="card-value">{card.value}</div>
                        </div>
                    ))}

                    {displayHand.length === 0 && status === 'playing' && (
                        <div className="empty-hand">
                            {isSpectator ? 'Current player has no cards' : 'No cards in hand'}
                        </div>
                    )}
                </div>

                {showColorPicker && pendingWildCard && (
                    <div className="color-picker-overlay">
                        <div className="color-picker">
                            <h3>Choose a color:</h3>
                            <div className="color-options">
                                {colors.map(color => (
                                    <div
                                        key={color}
                                        className={`color-option ${color.toLowerCase()}`}
                                        onClick={() => chooseWildColor(color, pendingWildCard.cardIndex, pendingWildCard.cardValue)}
                                    >
                                        {color}
                                    </div>
                                ))}
                            </div>
                            <button
                                className="cancel-button"
                                onClick={() => {
                                    setShowColorPicker(false);
                                    setPendingWildCard(null);
                                }}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}