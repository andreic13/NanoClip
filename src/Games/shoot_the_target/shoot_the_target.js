import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { database, ref, set, onValue, update, remove, onDisconnect, push, child } from "../../firebase";
import { auth, db } from '../../firebase';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp, onSnapshot } from 'firebase/firestore';

export default function ShootTheTargetGame() {
    const location = useLocation();
    const navigate = useNavigate();
    const { lobbyId, players: lobbyPlayers, isHost, isSpectator } = location.state || {};

    const canvasRef = useRef(null);
    const gameLoopRef = useRef(null);
    const arrowAnimationRef = useRef(null);
    const navigateTimeoutRef = useRef(null);

    const [playerCount, setPlayerCount] = useState(lobbyPlayers ? lobbyPlayers.length : 0);
    const [playerNumber, setPlayerNumber] = useState(null);
    const [cordVibration, setCordVibration] = useState({ active: false, amplitude: 0, frequency: 0, time: 0 });
    const [status, setStatus] = useState('waiting');
    const [localArrow, setLocalArrow] = useState(null);
    const [usernames, setUsernames] = useState({});
    const [spectators, setSpectators] = useState([]);
    const BASE_ELO_CHANGE = 20;

    const [gameState, setGameState] = useState({
        players: [],
        currentPlayer: 0,
        turnCount: 0,
        maxTurns: 5,
        target: { x: 600, y: 150 },
        bow: { angle: 0, power: 0, charging: false },
        shotData: null,
        scores: {},
        gameOver: false
    });

    const CANVAS_WIDTH = 800;
    const CANVAS_HEIGHT = 600;
    const GRAVITY = 0.3;
    const BOW_X = 100;
    const BOW_Y = 400;

    // Remove username input and game searching logic
    useEffect(() => {
        if (!lobbyId || !auth.currentUser) {
            navigate('/');
            return;
        }

        const fetchUsernames = async () => {
            const usernamesMap = {};
            // Fetch usernames for both players and spectators
            for (const playerId of lobbyPlayers) {
                const userDoc = await getDoc(doc(db, 'users', playerId));
                if (userDoc.exists()) {
                    usernamesMap[playerId] = userDoc.data().username || userDoc.data().email;
                }
            }
            setUsernames(usernamesMap);
        };

        fetchUsernames();

        // Initialize game state in Firestore (only for host)
        const initializeGame = async () => {
            if (!isHost) return;

            const initialGameState = {
                players: lobbyPlayers.map((playerId, index) => ({
                    id: playerId,
                    number: index
                })),
                spectators: [], // Add spectators array
                currentPlayer: 0,
                turnCount: 0,
                maxTurns: 5,
                target: generateRandomTarget(),
                bow: { angle: 0, power: 0, charging: false },
                shotData: null,
                scores: Object.fromEntries(lobbyPlayers.map(id => [id, 0])),
                gameOver: false,
                createdAt: serverTimestamp(),
                status: 'waiting'
            };

            await set(ref(database, `games/shoot_the_target/${lobbyId}`), initialGameState);
        };

        initializeGame();

        // Only set player number if not a spectator
        if (!isSpectator) {
            setPlayerNumber(lobbyPlayers.indexOf(auth.currentUser.uid));
        }

        // Listen to game state
        const gameRef = ref(database, `games/shoot_the_target/${lobbyId}`);
        const unsubscribe = onValue(gameRef, (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.val();
                setGameState(data);

                if (data.gameOver && !navigateTimeoutRef.current) {
                    navigateTimeoutRef.current = setTimeout(() => {
                        navigate('/');
                    }, 10000);
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

    const generateRandomTarget = () => ({
        x: Math.random() * 150 + 350, // Între 350-500 pixeli (distanță rezonabilă)
        y: Math.random() * 100 + 250  // Între 250-350 pixeli (mai jos, zona mai accesibilă)
    });

    const calculateEloChange = (position, totalPlayers) => {
        const isTopHalf = position <= Math.floor(totalPlayers / 2);
        const positionMultiplier = 1 - ((position - 1) / totalPlayers); // 1st place = 1, last place = 0
        const eloChange = Math.round(BASE_ELO_CHANGE * positionMultiplier);
        return isTopHalf ? eloChange : -eloChange;
    };

    const isMyTurn = () => {
        return gameState.currentPlayer === playerNumber;
    };

    const handleShoot = async () => {
        if (!isMyTurn() || gameState.bow.charging || localArrow) return;

        try {
            await update(ref(database, `games/shoot_the_target/${lobbyId}/bow`), {
                charging: true,
                power: 0
            });
        } catch (error) {
            console.error('Error starting charge:', error);
        }
    };

    // Update the release function
    const handleRelease = async () => {
        if (!isMyTurn() || !gameState.bow.charging) return;

        try {
            const shotData = {
                angle: gameState.bow.angle,
                power: gameState.bow.power,
                timestamp: new Date().getTime(),
                playerId: auth.currentUser.uid
            };

            await update(ref(database, `games/shoot_the_target/${lobbyId}/bow`), {
                charging: false,
                power: 0
            });
            await update(ref(database, `games/shoot_the_target/${lobbyId}`), {
                shotData: shotData,
            });
        } catch (error) {
            console.error('Error releasing arrow:', error);
        }
    };

    const nextTurn = async (newScores = null) => {
        if (!isMyTurn()) return;

        const nextPlayer = (gameState.currentPlayer + 1) % gameState.players.length;
        const nextTurnCount = nextPlayer === 0 ? gameState.turnCount + 1 : gameState.turnCount;

        const updates = {
            currentPlayer: nextPlayer,
            turnCount: nextTurnCount,
            shotData: null,
            'bow/angle': 0,
            'bow/power': 0,
            'bow/charging': false
        };

        if (newScores) {
            updates.scores = newScores;
        }

        if (nextPlayer === 0) {
            updates.target = generateRandomTarget();
        }

        if (nextTurnCount >= gameState.maxTurns) {
            updates.gameOver = true;
        }

        try {
            await update(ref(database, `games/shoot_the_target/${lobbyId}`), updates);
        } catch (error) {
            console.error('Error updating turn:', error);
        }
    };

    // Listen to game state changes
    useEffect(() => {
        if (!lobbyId) return;
        const gameRef = ref(database, `games/shoot_the_target/${lobbyId}`);
        const unsubscribe = onValue(gameRef, (snapshot) => {
            const data = snapshot.val();
            if (data) {
                setGameState(data);
                if (data.players.length === playerCount && status === 'waiting') {
                    setStatus('playing');
                }

                if (data.gameOver) {
                    setStatus('gameOver');
                }
            }
        });

        return unsubscribe;
    }, [lobbyId, status]);

    // Update the game loop effect to use lobbyId
    useEffect(() => {
        if (status !== 'playing' || !isMyTurn()) return;

        const gameLoop = async () => {
            if (isMyTurn() && !gameState.bow.charging && !gameState.arrow) {
                const newAngle = (gameState.bow.angle + 0.5) % 91;
                if (newAngle !== gameState.bow.angle) {
                    try {
                        await update(ref(database, `games/shoot_the_target/${lobbyId}/bow`), {
                            angle: newAngle,
                            power: gameState.bow.power,
                            charging: gameState.bow.charging
                        });
                    } catch (error) {
                        console.error('Error updating angle:', error);
                    }
                }
            }

            if (isMyTurn() && gameState.bow.charging) {
                const newPower = Math.min((gameState.bow.power || 0) + 2, 100);
                if (newPower !== gameState.bow.power) {
                    try {
                        await update(ref(database, `games/shoot_the_target/${lobbyId}/bow`), {
                            angle: gameState.bow.angle,
                            power: newPower,
                            charging: gameState.bow.charging
                        });
                    } catch (error) {
                        console.error('Error updating power:', error);
                    }
                }
            }
        };

        const intervalId = setInterval(gameLoop, 50);
        return () => clearInterval(intervalId);
    }, [status, gameState, lobbyId, playerNumber, localArrow]);

    // Handle arrow physics locally when shot data is received
    useEffect(() => {
        if (!gameState.shotData || localArrow) return;

        // Clear any existing arrow animation
        if (arrowAnimationRef.current) {
            clearInterval(arrowAnimationRef.current);
        }

        // PORNEȘTE VIBRAȚIA CORZII
        const shotPower = gameState.shotData.power;
        setCordVibration({
            active: true,
            amplitude: Math.min(shotPower * 0.15, 8), // amplitudine bazată pe putere
            frequency: 0.3 + (shotPower * 0.01), // frecvența crește cu puterea
            time: 0
        });

        // Oprește vibrația după 1.5 secunde
        setTimeout(() => {
            setCordVibration({ active: false, amplitude: 0, frequency: 0, time: 0 });
        }, 1500);

        // Initialize local arrow from shot data - pornește din poziția unde era săgeata
        const pullDistance = gameState.shotData.power * 0.4;
        const arrowStartX = BOW_X + (pullDistance * 0.5);
        const arrowStartY = BOW_Y;

        const initArrow = {
            x: arrowStartX,
            y: arrowStartY,
            vx: gameState.shotData.power * Math.cos(gameState.shotData.angle * Math.PI / 180) * 0.12,
            vy: -gameState.shotData.power * Math.sin(gameState.shotData.angle * Math.PI / 180) * 0.12,
            active: true
        };
        setLocalArrow(initArrow);

        // Animate arrow physics locally
        const updateArrowPhysics = () => {
            setLocalArrow(prev => {
                if (!prev || !prev.active) return prev;

                // Update arrow physics
                const newArrow = {
                    ...prev,
                    x: prev.x + prev.vx,
                    y: prev.y + prev.vy,
                    vy: prev.vy + GRAVITY
                };

                // Check collision with target
                const targetDistance = Math.sqrt(
                    Math.pow(newArrow.x - gameState.target.x, 2) +
                    Math.pow(newArrow.y - gameState.target.y, 2)
                );

                // Hit detection and scoring
                if (newArrow.x > CANVAS_WIDTH || newArrow.y > CANVAS_HEIGHT) {
                    // Săgeata a ieșit din ecran - ratare
                    if (gameState.shotData.playerId === auth.currentUser.uid) {
                        const newScores = { ...gameState.scores };
                        const currentPlayerId = gameState.players[gameState.currentPlayer].id;
                        newScores[currentPlayerId] = (newScores[currentPlayerId] || 0) + 0; // 0 puncte
                        setTimeout(() => nextTurn(newScores), 500);
                    }
                    return { ...newArrow, active: false };
                }

                // Verifică dacă săgeata a ieșit complet din țintă (după ce a fost înăuntru)
                if (targetDistance > 35) {
                    // Dacă săgeata era înăuntrul țintei și acum a ieșit, se oprește
                    if (prev.wasInTarget) {
                        if (gameState.shotData.playerId === auth.currentUser.uid) {
                            // Calculează punctajul în funcție de cea mai bună poziție
                            let points = 0;
                            const bestDistance = prev.bestDistance || targetDistance;
                            if (bestDistance < 7) points = 10;        // Bullseye
                            else if (bestDistance < 14) points = 8;   // Cercul roșu interior
                            else if (bestDistance < 21) points = 6;   // Cercul alb
                            else if (bestDistance < 28) points = 4;   // Cercul roșu exterior
                            else if (bestDistance < 35) points = 2;   // Cercul alb exterior

                            const newScores = { ...gameState.scores };
                            const currentPlayerId = gameState.players[gameState.currentPlayer].id;
                            newScores[currentPlayerId] = (newScores[currentPlayerId] || 0) + points;

                            setTimeout(() => nextTurn(newScores), 2000);
                        }
                        return { ...newArrow, active: false, stuck: true, stuckX: newArrow.x, stuckY: newArrow.y };
                    }
                } else {
                    // Săgeata e în țintă - continuă să zboare dar ține evidența
                    const currentBest = prev.bestDistance || 999;
                    newArrow.wasInTarget = true;
                    newArrow.bestDistance = Math.min(currentBest, targetDistance);
                }

                return newArrow;
            });
        };

        arrowAnimationRef.current = setInterval(updateArrowPhysics, 16); // ~60fps

        return () => {
            if (arrowAnimationRef.current) {
                clearInterval(arrowAnimationRef.current);
            }
        };
    }, [gameState.shotData]);

    // Clear local arrow when shot data is cleared (turn change)
    useEffect(() => {
        if (!gameState.shotData && localArrow) {
            setLocalArrow(null);
        }
    }, [gameState.shotData]);

    useEffect(() => {
        if (!cordVibration.active) return;

        const vibrateInterval = setInterval(() => {
            setCordVibration(prev => ({
                ...prev,
                time: prev.time + 0.1,
                amplitude: prev.amplitude * 0.985 // scade gradual amplitudinea
            }));
        }, 16); // ~60fps

        return () => clearInterval(vibrateInterval);
    }, [cordVibration.active]);

    // Draw game
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');

        const draw = () => {
            // Clear canvas
            ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

            // Draw sky
            // ctx.fillStyle = '#87CEEB';
            // ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT * 0.8);

            const skyGradient = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT * 0.8);
            skyGradient.addColorStop(0, '#87CEEB'); // cer deschis sus
            skyGradient.addColorStop(1, '#B0E0E6'); // albastru foarte deschis jos
            ctx.fillStyle = skyGradient;
            ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT * 0.8);

            function drawRealisticSun() {
                const sunX = CANVAS_WIDTH - 120;
                const sunY = 80;
                const sunRadius = 45;

                ctx.save();

                // Raze externe luminoase (mai multe și mai frumoase)
                for (let i = 0; i < 16; i++) {
                    const angle = i * Math.PI / 8;
                    const rayLength = 25 + Math.sin(i * 0.5) * 8; // lungimi variabile
                    const x1 = sunX + Math.cos(angle) * (sunRadius + 5);
                    const y1 = sunY + Math.sin(angle) * (sunRadius + 5);
                    const x2 = sunX + Math.cos(angle) * (sunRadius + rayLength);
                    const y2 = sunY + Math.sin(angle) * (sunRadius + rayLength);

                    // Gradient pentru raze
                    const rayGradient = ctx.createLinearGradient(x1, y1, x2, y2);
                    rayGradient.addColorStop(0, 'rgba(255, 215, 0, 0.9)');
                    rayGradient.addColorStop(1, 'rgba(255, 215, 0, 0.2)');

                    ctx.strokeStyle = rayGradient;
                    ctx.lineWidth = 3;
                    ctx.lineCap = 'round';
                    ctx.beginPath();
                    ctx.moveTo(x1, y1);
                    ctx.lineTo(x2, y2);
                    ctx.stroke();
                }

                // Raze interioare mai scurte
                for (let i = 0; i < 8; i++) {
                    const angle = (i * Math.PI / 4) + (Math.PI / 8); // offset pentru alternare
                    const rayLength = 15;
                    const x1 = sunX + Math.cos(angle) * (sunRadius + 2);
                    const y1 = sunY + Math.sin(angle) * (sunRadius + 2);
                    const x2 = sunX + Math.cos(angle) * (sunRadius + rayLength);
                    const y2 = sunY + Math.sin(angle) * (sunRadius + rayLength);

                    ctx.strokeStyle = 'rgba(255, 215, 0, 0.6)';
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.moveTo(x1, y1);
                    ctx.lineTo(x2, y2);
                    ctx.stroke();
                }

                // Halo exterior pentru strălucire
                const haloGradient = ctx.createRadialGradient(sunX, sunY, sunRadius, sunX, sunY, sunRadius + 15);
                haloGradient.addColorStop(0, 'rgba(255, 255, 0, 0.3)');
                haloGradient.addColorStop(1, 'rgba(255, 255, 0, 0)');
                ctx.fillStyle = haloGradient;
                ctx.beginPath();
                ctx.arc(sunX, sunY, sunRadius + 15, 0, Math.PI * 2);
                ctx.fill();

                // Corpul principal al soarelui cu gradient
                const sunGradient = ctx.createRadialGradient(
                    sunX - 10, sunY - 10, 0,  // punct de highlight
                    sunX, sunY, sunRadius
                );
                sunGradient.addColorStop(0, '#FFF8DC');    // cream foarte deschis
                sunGradient.addColorStop(0.3, '#FFD700');  // auriu
                sunGradient.addColorStop(0.7, '#FFA500');  // portocaliu
                sunGradient.addColorStop(1, '#FF8C00');    // portocaliu închis

                ctx.fillStyle = sunGradient;
                ctx.beginPath();
                ctx.arc(sunX, sunY, sunRadius, 0, Math.PI * 2);
                ctx.fill();

                // Highlight principal pentru strălucire
                ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
                ctx.beginPath();
                ctx.arc(sunX - 12, sunY - 12, 12, 0, Math.PI * 2);
                ctx.fill();

                // Highlight secundar
                ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
                ctx.beginPath();
                ctx.arc(sunX + 8, sunY - 15, 6, 0, Math.PI * 2);
                ctx.fill();

                // Contur subtil
                ctx.strokeStyle = 'rgba(255, 140, 0, 0.8)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.arc(sunX, sunY, sunRadius, 0, Math.PI * 2);
                ctx.stroke();

                ctx.restore();
            }

            drawRealisticSun();


            function drawRealisticCloud(x, y, scale = 1, opacity = 1) {
                ctx.save();
                ctx.globalAlpha = opacity;

                // Umbra norului pentru profunzime
                ctx.fillStyle = 'rgba(180, 180, 180, 0.4)';
                ctx.beginPath();
                ctx.arc(x + 3, y + 3, 18 * scale, 0, Math.PI * 2);
                ctx.arc(x + 28 * scale, y - 7 * scale, 23 * scale, 0, Math.PI * 2);
                ctx.arc(x + 53 * scale, y + 3, 18 * scale, 0, Math.PI * 2);
                ctx.arc(x + 15 * scale, y - 15 * scale, 15 * scale, 0, Math.PI * 2);
                ctx.arc(x + 40 * scale, y - 18 * scale, 18 * scale, 0, Math.PI * 2);
                ctx.closePath();
                ctx.fill();

                // Gradient pentru norul principal
                const gradient = ctx.createRadialGradient(x + 25 * scale, y - 10 * scale, 0, x + 25 * scale, y - 10 * scale, 40 * scale);
                gradient.addColorStop(0, '#FFFFFF');
                gradient.addColorStop(0.6, '#F8F8FF');
                gradient.addColorStop(1, '#E6E6FA');

                ctx.fillStyle = gradient;

                // Corpul principal al norului
                ctx.beginPath();
                ctx.arc(x, y, 18 * scale, 0, Math.PI * 2);
                ctx.arc(x + 25 * scale, y - 10 * scale, 25 * scale, 0, Math.PI * 2);
                ctx.arc(x + 50 * scale, y, 18 * scale, 0, Math.PI * 2);
                ctx.arc(x + 12 * scale, y - 15 * scale, 15 * scale, 0, Math.PI * 2);
                ctx.arc(x + 38 * scale, y - 18 * scale, 18 * scale, 0, Math.PI * 2);
                ctx.arc(x + 20 * scale, y + 8 * scale, 12 * scale, 0, Math.PI * 2);
                ctx.arc(x + 35 * scale, y + 5 * scale, 14 * scale, 0, Math.PI * 2);
                ctx.closePath();
                ctx.fill();

                // Highlights pentru strălucire
                ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
                ctx.beginPath();
                ctx.arc(x + 15 * scale, y - 12 * scale, 8 * scale, 0, Math.PI * 2);
                ctx.arc(x + 35 * scale, y - 15 * scale, 6 * scale, 0, Math.PI * 2);
                ctx.fill();

                ctx.restore();
            }

            // Desenează soarele mai întâi
            drawRealisticSun();

            // Apoi desenează norii în straturi multiple
            // Stratul din fundal (cei mai depărtați)
            drawRealisticCloud(60, 85, 0.6, 0.7);
            drawRealisticCloud(450, 90, 0.7, 0.6);
            drawRealisticCloud(550, 45, 0.5, 0.8);

            // Stratul mijlociu
            drawRealisticCloud(180, 65, 0.9, 0.85);
            drawRealisticCloud(350, 110, 1.0, 0.8);
            drawRealisticCloud(200, 40, 0.8, 0.75);

            // Stratul din față (cei mai apropiați)
            drawRealisticCloud(100, 50, 1.1, 0.9);
            drawRealisticCloud(300, 75, 1.2, 0.95);

            // Norul care acoperă parțial soarele (în dreapta)
            drawRealisticCloud(CANVAS_WIDTH - 180, 60, 1.0, 0.9);

            // Nori foarte mici pentru detaliu
            drawRealisticCloud(400, 50, 0.4, 0.6);
            drawRealisticCloud(520, 85, 0.45, 0.7);
            drawRealisticCloud(150, 30, 0.35, 0.5);

            const trees = [
                { x: 100, trunkH: 100, trunkW: 18, crownR: 35, crownOffsetY: 10 },
                { x: 230, trunkH: 140, trunkW: 24, crownR: 45, crownOffsetY: 20 },
                { x: 400, trunkH: 110, trunkW: 20, crownR: 38, crownOffsetY: 12 },
                { x: 620, trunkH: 130, trunkW: 22, crownR: 42, crownOffsetY: 18 }
            ];


            function drawAdvancedTree(ctx, x, baseY, scale, treeType = 'oak') {
                ctx.save();

                const trunkHeight = (60 + Math.sin(x * 0.01) * 15) * scale;
                const trunkWidth = (12 + Math.cos(x * 0.015) * 3) * scale;

                if (treeType === 'oak') {
                    // Copac stejar cu trunchi texturat
                    const trunkGradient = ctx.createLinearGradient(x, baseY, x + trunkWidth, baseY - trunkHeight);
                    trunkGradient.addColorStop(0, '#8B4513');
                    trunkGradient.addColorStop(0.3, '#A0522D');
                    trunkGradient.addColorStop(0.7, '#654321');
                    trunkGradient.addColorStop(1, '#3E2723');

                    ctx.fillStyle = trunkGradient;
                    ctx.fillRect(x, baseY - trunkHeight, trunkWidth, trunkHeight);

                    // Textura pe trunchi
                    ctx.strokeStyle = '#5D4037';
                    ctx.lineWidth = 1 * scale;
                    for (let i = 0; i < 4; i++) {
                        const yPos = baseY - trunkHeight * (0.2 + i * 0.2);
                        ctx.beginPath();
                        ctx.moveTo(x, yPos);
                        ctx.lineTo(x + trunkWidth, yPos);
                        ctx.stroke();
                    }

                    // Coroana în straturi pentru volum
                    const crownLayers = [
                        { radius: 35 * scale, yOffset: 0.8, color: '#2E7D32' },
                        { radius: 32 * scale, yOffset: 0.9, color: '#388E3C' },
                        { radius: 28 * scale, yOffset: 1.0, color: '#4CAF50' },
                        { radius: 24 * scale, yOffset: 1.1, color: '#66BB6A' }
                    ];

                    crownLayers.forEach(layer => {
                        ctx.fillStyle = layer.color;
                        ctx.beginPath();
                        ctx.arc(x + trunkWidth / 2, baseY - trunkHeight * layer.yOffset, layer.radius, 0, Math.PI * 2);
                        ctx.fill();
                    });

                } else if (treeType === 'pine') {
                    // Copac conifer
                    ctx.fillStyle = '#5D4037';
                    ctx.fillRect(x, baseY - trunkHeight, trunkWidth * 0.7, trunkHeight);

                    // Coroana triunghiulară în straturi
                    const layers = 4;
                    for (let i = 0; i < layers; i++) {
                        const layerY = baseY - trunkHeight * (0.3 + i * 0.25);
                        const layerWidth = (25 - i * 4) * scale;
                        const layerHeight = 20 * scale;

                        ctx.fillStyle = `hsl(120, 40%, ${25 + i * 5}%)`;
                        ctx.beginPath();
                        ctx.moveTo(x + trunkWidth * 0.35 - layerWidth, layerY);
                        ctx.lineTo(x + trunkWidth * 0.35, layerY - layerHeight);
                        ctx.lineTo(x + trunkWidth * 0.35 + layerWidth, layerY);
                        ctx.closePath();
                        ctx.fill();
                    }

                } else if (treeType === 'birch') {
                    // Mesteacăn cu trunchi alb
                    ctx.fillStyle = '#F5F5F5';
                    ctx.fillRect(x, baseY - trunkHeight, trunkWidth * 0.8, trunkHeight);

                    // Dungile negre pe trunchi
                    ctx.fillStyle = '#000';
                    for (let i = 0; i < 3; i++) {
                        const stripY = baseY - trunkHeight * (0.3 + i * 0.3);
                        ctx.fillRect(x, stripY, trunkWidth * 0.8, 3 * scale);
                    }

                    // Coroana mai mică și delicată
                    ctx.fillStyle = '#90EE90';
                    ctx.beginPath();
                    ctx.arc(x + trunkWidth * 0.4, baseY - trunkHeight * 0.9, 25 * scale, 0, Math.PI * 2);
                    ctx.fill();
                }

                ctx.restore();
            }

            function drawRealisticForest(ctx, canvasWidth, canvasHeight) {
                const baseY = canvasHeight * 0.80;

                // Stratul din fundal (copaci foarte depărtați, mai mici și mai întunecați)
                const backgroundTrees = [
                    { x: 280, scale: 0.3, type: 'pine', opacity: 0.4 },
                    { x: 320, scale: 0.25, type: 'oak', opacity: 0.35 },
                    { x: 360, scale: 0.28, type: 'pine', opacity: 0.4 },
                    { x: 400, scale: 0.32, type: 'oak', opacity: 0.38 },
                    { x: 450, scale: 0.27, type: 'birch', opacity: 0.36 },
                    { x: 490, scale: 0.29, type: 'pine', opacity: 0.42 },
                    { x: 540, scale: 0.26, type: 'oak', opacity: 0.37 },
                    { x: 580, scale: 0.31, type: 'pine', opacity: 0.39 },
                    { x: 620, scale: 0.28, type: 'oak', opacity: 0.35 },
                    { x: 660, scale: 0.33, type: 'birch', opacity: 0.41 },
                    { x: 700, scale: 0.29, type: 'pine', opacity: 0.38 },
                    { x: 740, scale: 0.27, type: 'oak', opacity: 0.36 }
                ];

                // Stratul mijlociu
                const middleTrees = [
                    { x: 260, scale: 0.5, type: 'oak', opacity: 0.7 },
                    { x: 340, scale: 0.45, type: 'pine', opacity: 0.65 },
                    { x: 420, scale: 0.52, type: 'birch', opacity: 0.68 },
                    { x: 480, scale: 0.48, type: 'oak', opacity: 0.72 },
                    { x: 560, scale: 0.46, type: 'pine', opacity: 0.66 },
                    { x: 640, scale: 0.51, type: 'oak', opacity: 0.69 },
                    { x: 720, scale: 0.47, type: 'birch', opacity: 0.71 },
                    { x: 780, scale: 0.49, type: 'pine', opacity: 0.67 }
                ];

                // Stratul din față (copaci apropiați, mari și clare)
                const foregroundTrees = [
                    { x: 240, scale: 0.8, type: 'oak', opacity: 0.9 },
                    { x: 380, scale: 0.75, type: 'pine', opacity: 0.85 },
                    { x: 520, scale: 0.82, type: 'birch', opacity: 0.88 },
                    { x: 680, scale: 0.78, type: 'oak', opacity: 0.87 },
                    { x: 760, scale: 0.76, type: 'pine', opacity: 0.86 }
                ];

                // Desenează în ordine pentru perspectivă corectă
                [backgroundTrees, middleTrees, foregroundTrees].forEach(layer => {
                    layer.forEach(tree => {
                        ctx.save();
                        ctx.globalAlpha = tree.opacity;
                        drawAdvancedTree(ctx, tree.x, baseY, tree.scale, tree.type);
                        ctx.restore();
                    });
                });
            }

            drawRealisticForest(ctx, canvas.width, canvas.height);
            ctx.fillStyle = '#228B22'; // verde închis
            ctx.fillRect(0, CANVAS_HEIGHT * 0.8, CANVAS_WIDTH, CANVAS_HEIGHT * 0.2);

            // Textură simplă de iarbă
            function drawRealisticGround(ctx, canvasWidth, canvasHeight) {
                const groundY = canvasHeight * 0.8;
                const groundHeight = canvasHeight * 0.2;

                // Gradient pentru sol - de la verde deschis la verde închis
                const groundGradient = ctx.createLinearGradient(0, groundY, 0, canvasHeight);
                groundGradient.addColorStop(0, '#32CD32'); // verde deschis sus
                groundGradient.addColorStop(0.3, '#228B22'); // verde mediu
                groundGradient.addColorStop(1, '#006400'); // verde închis jos
                ctx.fillStyle = groundGradient;
                ctx.fillRect(0, groundY, canvasWidth, groundHeight);
            }

            drawRealisticGround(ctx, canvas.width, canvas.height);
            // Draw ground
            // ctx.fillStyle = '#8B4513';
            // ctx.fillRect(0, CANVAS_HEIGHT * 0.8, CANVAS_WIDTH, CANVAS_HEIGHT * 0.2);

            // Draw bow
            // Modifică constantele pentru poziția arcului
            const BOW_Y = 400;
            ctx.save();
            ctx.translate(BOW_X, BOW_Y);

            // Inversează orizontal (coarda devine în stânga, partea curbată în dreapta)
            ctx.scale(-1, 1);

            // Bow body – arc din lemn cu textură
            // Partea principală a arcului - maro deschis
            ctx.strokeStyle = '#8B4513'; // maro lemn
            ctx.lineWidth = 8;
            ctx.beginPath();
            ctx.arc(0, 0, 40, Math.PI / 2, Math.PI * 3 / 2);
            ctx.stroke();

            // Stratul interior - maro mai închis pentru profunzime
            ctx.strokeStyle = '#5D4037'; // maro închis
            ctx.lineWidth = 6;
            ctx.beginPath();
            ctx.arc(0, 0, 40, Math.PI / 2, Math.PI * 3 / 2);
            ctx.stroke();

            // Stratul interior - maro deschis pentru highlight
            ctx.strokeStyle = '#A0522D'; // maro siena
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(0, 0, 40, Math.PI / 2, Math.PI * 3 / 2);
            ctx.stroke();



            // Capetele arcului (întărituri)
            ctx.fillStyle = '#654321';
            ctx.beginPath();
            ctx.ellipse(0, -40, 4, 6, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.ellipse(0, 40, 4, 6, 0, 0, Math.PI * 2);
            ctx.fill();

            // Coarda (acum e în stânga ecranului) - cu deformare când se încarcă și vibrații după tragere
            ctx.strokeStyle = isMyTurn() ? '#F5DEB3' : '#DDD';
            ctx.lineWidth = 2;

            // Calculează deformarea în funcție de putere
            const bowPower = gameState.bow.power || 0;
            const pullDistance = gameState.bow.charging ? (bowPower * 0.4) : 0;

            // Calculează vibrația
            let vibrationOffset = 0;
            if (cordVibration.active) {
                vibrationOffset = Math.sin(cordVibration.time * cordVibration.frequency * 20) * cordVibration.amplitude;
            }

            ctx.beginPath();
            ctx.moveTo(0, -40);
            // Coardă curbată când se trage + vibrație
            ctx.quadraticCurveTo(pullDistance + vibrationOffset, 0, 0, 40);
            ctx.stroke();

            // Highlight pe coardă pentru strălucire - și el curbat cu vibrație
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(1, -40);
            ctx.quadraticCurveTo(pullDistance + 1 + vibrationOffset, 0, 1, 40);
            ctx.stroke();

            // Efect de vibrație vizuală - linii suplimentare pentru motion blur
            if (cordVibration.active && cordVibration.amplitude > 1) {
                ctx.strokeStyle = 'rgba(245, 222, 179, 0.3)';
                ctx.lineWidth = 1;

                // Desenează coarde suplimentare pentru efectul de blur
                for (let i = -2; i <= 2; i++) {
                    if (i === 0) continue;
                    ctx.beginPath();
                    ctx.moveTo(0, -40);
                    ctx.quadraticCurveTo(pullDistance + vibrationOffset + i, 0, 0, 40);
                    ctx.stroke();
                }
            }


            // Linie de direcție săgeată (vizuală)
            if (!localArrow) {
                const angle = gameState.bow.angle * Math.PI / 180;
                const bowPower = gameState.bow.power || 0;
                const pullDistance = gameState.bow.charging ? (bowPower * 0.4) : 0;

                // Punctul de pe coardă unde e săgeata (exact la mijlocul corzii curbe)
                const arrowStartX = pullDistance * 0.5; // mijlocul curbei
                const arrowStartY = 0;

                // Desenează săgeata
                ctx.save();
                ctx.translate(arrowStartX, arrowStartY);
                ctx.rotate(angle); // rotește săgeata în direcția unghiului

                // Lungimea săgeții - constantă, doar poziția se schimbă
                const arrowLength = 60; // mai lungă ca să iasă din cerc

                // Corpul săgeții
                ctx.strokeStyle = isMyTurn() ? '#8B4513' : '#999'; // maro lemn
                ctx.lineWidth = 4;
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.lineTo(-arrowLength, 0); // săgeata se întinde spre stânga
                ctx.stroke();

                // Vârful săgeții (la dreapta, poziția 0)
                ctx.fillStyle = isMyTurn() ? '#2F4F4F' : '#666'; // gri închis metal
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.lineTo(-5, -4);
                ctx.lineTo(-5, 4);
                ctx.closePath();
                ctx.fill();

                // Penele săgeții (la stânga, la capătul corpului)
                ctx.fillStyle = isMyTurn() ? '#FF6B6B' : '#999';
                ctx.beginPath();
                ctx.moveTo(-arrowLength, 0);
                ctx.lineTo(-arrowLength + 5, -3);
                ctx.lineTo(-arrowLength + 5, 3);
                ctx.closePath();
                ctx.fill();

                ctx.restore();
            }
            ctx.restore();

            // Draw power bar when charging
            if (gameState.bow.charging) {
                ctx.fillStyle = 'rgba(255, 0, 0, 0.7)';
                ctx.fillRect(BOW_X - 50, BOW_Y + 50, gameState.bow.power * 0.8, 15);
                ctx.strokeStyle = '#000';
                ctx.strokeRect(BOW_X - 50, BOW_Y + 50, 80, 15);
            }

            // Draw target - țintă realistă cu cercuri concentrice (mai mare)
            const targetX = gameState.target.x;
            const targetY = gameState.target.y;

            // Cercul exterior - alb (mai mare)
            ctx.beginPath();
            ctx.arc(targetX, targetY, 35, 0, Math.PI * 2); // era 25, acum 35
            ctx.fillStyle = 'white';
            ctx.fill();
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 2;
            ctx.stroke();

            // Cercul roșu
            ctx.beginPath();
            ctx.arc(targetX, targetY, 28, 0, Math.PI * 2); // era 20, acum 28
            ctx.fillStyle = '#FF0000';
            ctx.fill();

            // Cercul alb
            ctx.beginPath();
            ctx.arc(targetX, targetY, 21, 0, Math.PI * 2); // era 15, acum 21
            ctx.fillStyle = 'white';
            ctx.fill();

            // Cercul roșu
            ctx.beginPath();
            ctx.arc(targetX, targetY, 14, 0, Math.PI * 2); // era 10, acum 14
            ctx.fillStyle = '#FF0000';
            ctx.fill();

            // Centrul - galben/auriu pentru bullseye
            ctx.beginPath();
            ctx.arc(targetX, targetY, 7, 0, Math.PI * 2); // era 5, acum 7
            ctx.fillStyle = '#FFD700';
            ctx.fill();
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 1;
            ctx.stroke();
            // Draw arrow (rendered locally)
            if (localArrow && localArrow.active) {
                ctx.save();
                ctx.translate(localArrow.x, localArrow.y);
                ctx.rotate(Math.atan2(localArrow.vy, localArrow.vx));

                // Arrow body
                ctx.fillStyle = '#8B4513';
                ctx.fillRect(-20, -2, 40, 4);

                // Arrow head (mai ascuțit)
                ctx.beginPath();
                ctx.moveTo(20, 0);
                ctx.lineTo(8, -6);  // mai ascuțit: era -10, acum -6
                ctx.lineTo(8, 6);   // mai ascuțit: era 10, acum 6
                ctx.closePath();
                ctx.fillStyle = '#000';
                ctx.fill();

                // Arrow fletching
                ctx.beginPath();
                ctx.moveTo(-20, 0);
                ctx.lineTo(-15, -5);
                ctx.lineTo(-15, 5);
                ctx.closePath();
                ctx.fillStyle = '#fff';
                ctx.fill();

                ctx.restore();
            }


            // Previzualizare traiectorie (doar când nu se încarcă și e rândul tău)
            // if (!localArrow && isMyTurn() && !gameState.bow.charging) {
            //     const angle = gameState.bow.angle * Math.PI / 180;
            //     const power = 65; // putere fixă pentru previzualizare

            //     // Punctul de start
            //     const startX = BOW_X;
            //     const startY = BOW_Y;

            //     // Viteza inițială
            //     let simVx = power * Math.cos(angle) * 0.12;
            //     let simVy = -power * Math.sin(angle) * 0.12;

            //     let simX = startX;
            //     let simY = startY;

            //     // Culoare mai pronunțată - roșu intens
            //     ctx.fillStyle = 'rgba(255, 50, 50, 0.8)'; // roșu pronunțat

            //     // Simulează traiectoria
            //     for (let step = 0; step < 200; step++) {
            //         simX = simX + simVx;
            //         simY = simY + simVy;
            //         simVx = simVx * 0.998;
            //         simVy = simVy + 0.5;

            //         // Desenează la fiecare al 4-lea pas pentru claritate
            //         if (step % 4 === 0) {
            //             ctx.beginPath();
            //             ctx.arc(simX, simY, 3, 0, Math.PI * 2); // puncte mai mari (3 în loc de 2)
            //             ctx.fill();
            //         }

            //         if (simX > CANVAS_WIDTH || simY > CANVAS_HEIGHT) break;
            //     }
            // }
            // Draw UI
            // Scoreboard frumos în colțul stânga sus
            function drawScoreboard() {
                const boardWidth = 220;
                const boardHeight = status === 'gameOver' ?
                    180 + ((gameState.players.length - 2) * 20) :
                    120 + ((gameState.players.length - 2) * 20);
                const boardX = 15;
                const boardY = 15;

                // Fundal solid pentru a bloca complet backgroundul
                ctx.fillStyle = 'rgba(0, 0, 0, 0.95)';
                ctx.fillRect(boardX, boardY, boardWidth, boardHeight);

                // Gradient peste fundalul solid
                const gradient = ctx.createLinearGradient(boardX, boardY, boardX, boardY + boardHeight);
                gradient.addColorStop(0, 'rgba(20, 20, 20, 0.8)');
                gradient.addColorStop(1, 'rgba(50, 50, 50, 0.8)');
                ctx.fillStyle = gradient;
                ctx.fillRect(boardX, boardY, boardWidth, boardHeight);

                // Chenar frumos
                ctx.strokeStyle = '#FFD700';
                ctx.lineWidth = 3;
                ctx.strokeRect(boardX, boardY, boardWidth, boardHeight);

                // Chenar interior
                ctx.strokeStyle = 'rgba(255, 215, 0, 0.5)';
                ctx.lineWidth = 1;
                ctx.strokeRect(boardX + 5, boardY + 5, boardWidth - 10, boardHeight - 10);

                // Titlu
                ctx.fillStyle = '#FFD700';
                ctx.font = 'bold 16px Arial';
                ctx.textAlign = 'center';
                ctx.fillText('SCOREBOARD', boardX + boardWidth / 2, boardY + 14);

                // Linie separator
                ctx.strokeStyle = '#FFD700';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(boardX + 15, boardY + 30);
                ctx.lineTo(boardX + boardWidth - 15, boardY + 30);
                ctx.stroke();

                if (status === 'waiting') {
                    ctx.fillStyle = '#FFF';
                    ctx.font = '13px Arial';
                    ctx.textAlign = 'center';
                    ctx.fillText('Waiting for opponent...', boardX + boardWidth / 2, boardY + 55);
                } else if (status === 'playing') {
                    const startY = boardY + 70;
                    const playerHeight = 22;

                    // Turn indicator
                    ctx.font = 'bold 13px Arial';
                    ctx.textAlign = 'left';
                    if (isSpectator) {
                        ctx.fillStyle = '#FFFFFF';
                        ctx.font = '12px Arial';
                        ctx.fillText('👀 SPECTATING', boardX + 12, boardY + 50);
                    } else if (isMyTurn()) {
                        ctx.fillStyle = '#00FF00';
                        ctx.fillText('🏹 YOUR TURN', boardX + 12, boardY + 50);
                    } else {
                        ctx.fillStyle = '#FF6B6B';
                        ctx.fillText('⏳ OPPONENT\'S TURN', boardX + 12, boardY + 50);
                    }

                    // Turn counter
                    ctx.fillStyle = '#CCC';
                    ctx.font = '11px Arial';
                    ctx.textAlign = 'right';
                    ctx.fillText(`Turn ${gameState.turnCount + 1}/${gameState.maxTurns}`, boardX + boardWidth - 12, boardY + 50);

                    // Players and scores - MINIMAL VERSION
                    if (gameState.players && gameState.players.length > 0) {
                        for (let i = 0; i < gameState.players.length; i++) {
                            const player = gameState.players[i];
                            const score = gameState.scores[player.id] || 0;
                            const username = usernames[player.id] || player.username || `Player ${i + 1}`;
                            const yPos = startY + 20 + (i * playerHeight);

                            // Highlight current player's turn
                            if (i === gameState.currentPlayer) {
                                ctx.fillStyle = 'rgba(255, 215, 0, 0.2)';
                                ctx.fillRect(boardX + 5, yPos - 15, boardWidth - 10, 20);
                            }

                            // Draw player name and score
                            ctx.fillStyle = i === gameState.currentPlayer ? '#FFD700' : '#FFFFFF';
                            ctx.font = '14px Arial';
                            ctx.textAlign = 'left';
                            ctx.textBaseline = 'top';
                            ctx.fillText(`${username}`, boardX + 12, yPos - 10);

                            // Draw score
                            ctx.textAlign = 'right';
                            ctx.fillText(`${score}`, boardX + boardWidth - 12, yPos - 10);
                        }
                    } else {
                        ctx.fillStyle = '#FFF';
                        ctx.font = '14px Arial';
                        ctx.textAlign = 'center';
                        ctx.fillText('Waiting for players...', boardX + boardWidth / 2, startY + 20);
                    }

                } else if (status === 'gameOver') {
                    // Game Over section - keeping original
                    ctx.fillStyle = '#FF4444';
                    ctx.font = 'bold 16px Arial';
                    ctx.textAlign = 'center';
                    ctx.fillText('🏆 GAME OVER', boardX + boardWidth / 2, boardY + 55);

                    // Find winner(s)
                    let maxScore = -1;
                    let winners = [];

                    gameState.players.forEach(player => {
                        const score = gameState.scores[player.id] || 0;
                        if (score > maxScore) {
                            maxScore = score;
                            winners = [player];
                        } else if (score === maxScore) {
                            winners.push(player);
                        }
                    });

                    // Show results
                    let resultColor = '#FFD700';
                    let resultText = '';
                    let isWinner = false;
                    let isLoser = false;

                    if (winners.length > 1) {
                        resultText = `DRAW: ${maxScore} points`;
                        resultColor = '#FFD700';
                    } else {
                        const winner = winners[0];
                        const myPlayer = gameState.players.find(p => p.number === playerNumber);
                        if (isSpectator) {
                            const winnerUsername = usernames[winner.id] || 'Unknown';
                            resultText = `${winnerUsername} Wins: ${maxScore} points`;
                            resultColor = '#FFD700';
                        } else if (myPlayer && winner.id === myPlayer.id) {
                            resultText = `YOU WIN: ${maxScore} points`;
                            resultColor = '#00FF00';
                            isWinner = true;
                        } else {
                            resultText = `YOU LOSE`;
                            resultColor = '#FF4444';
                            isLoser = true;
                        }
                    }

                    ctx.fillStyle = resultColor;
                    ctx.font = 'bold 14px Arial';
                    ctx.fillText(resultText, boardX + boardWidth / 2, boardY + 80);

                    // Final scores - FORCE SHOW ALL PLAYERS
                    ctx.font = '12px Arial';
                    ctx.textAlign = 'left';
                    ctx.fillStyle = '#CCC';
                    ctx.fillText('Final Scores:', boardX + 15, boardY + 120);

                    const sortedPlayers = [...gameState.players].sort((a, b) => {
                        return (gameState.scores[b.id] || 0) - (gameState.scores[a.id] || 0);
                    });

                    // Update ELO only for current player
                    const handleGameEnd = async () => {
                        if (!isSpectator && auth.currentUser) {
                            const myPosition = sortedPlayers.findIndex(p => p.id === auth.currentUser.uid) + 1;
                            const eloChange = calculateEloChange(myPosition, sortedPlayers.length);

                            try {
                                const userRef = doc(db, 'users', auth.currentUser.uid);
                                const userDoc = await getDoc(userRef);

                                if (userDoc.exists()) {
                                    const userData = userDoc.data();
                                    const currentStats = userData.stats || {};
                                    const currentElo = currentStats.sttElo || 1000;

                                    await updateDoc(userRef, {
                                        'stats.sttElo': currentElo + eloChange
                                    });
                                } else {
                                    // Create user document with stats field
                                    await setDoc(userRef, {
                                        stats: {
                                            sttElo: 1000 + eloChange
                                        }
                                    });
                                }
                            } catch (error) {
                                console.error('Error updating ELO:', error);
                            }
                        }
                    };
                    handleGameEnd();

                    gameState.players.forEach((player, i) => {
                        const score = gameState.scores[player.id] || 0;
                        const yPos = boardY + 135 + (i * 15); // ajustat de la 145
                        const username = usernames[player.id] || `Player ${i + 1}`;

                        // Determină culoarea pentru fiecare jucător
                        let playerColor = '#CCC';
                        const myPlayer = gameState.players.find(p => p.number === playerNumber);

                        if (winners.length === 1 && winners[0].id === player.id) {
                            // Câștigătorul
                            playerColor = myPlayer && player.id === myPlayer.id ? '#00FF00' : '#90EE90';
                        } else if (winners.length > 1 && winners.some(w => w.id === player.id)) {
                            // Egalitate
                            playerColor = '#FFD700';
                        } else {
                            // Pierzătorul
                            playerColor = myPlayer && player.id === myPlayer.id ? '#FF6B6B' : '#CCC';
                        }

                        ctx.fillStyle = playerColor;

                        // Adaugă indicator pentru jucătorul curent
                        const position = sortedPlayers.findIndex(p => p.id === player.id) + 1;
                        const eloChange = calculateEloChange(position, gameState.players.length);
                        const eloChangeText = eloChange >= 0 ? `+${eloChange}` : eloChange;
                        const prefix = myPlayer && player.id === myPlayer.id ? '► ' : '    ';
                        ctx.fillText(`${prefix}${username}(${eloChangeText}): ${score}`, boardX + 15, yPos);
                    });
                }
            }

            drawScoreboard();

            function drawControls() {
                const controlsY = CANVAS_HEIGHT - 35;
                const controlsHeight = 25;

                // Fundal pentru controls
                ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
                ctx.fillRect(0, controlsY, CANVAS_WIDTH, controlsHeight);

                // Chenar subtil
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
                ctx.lineWidth = 1;
                ctx.strokeRect(0, controlsY, CANVAS_WIDTH, controlsHeight);

                // Text controls
                ctx.fillStyle = '#FFF';
                ctx.font = '14px Arial';
                ctx.textAlign = 'center';

                ctx.fillText('🖱️ Controls: Hold mouse button to charge power, release to shoot', CANVAS_WIDTH / 2, controlsY + 7);
            }

            drawControls();
        };

        draw();
        gameLoopRef.current = requestAnimationFrame(draw);

        return () => {
            if (gameLoopRef.current) {
                cancelAnimationFrame(gameLoopRef.current);
            }
        };
    }, [gameState, status, playerNumber, localArrow]);

    // Handle mouse events
    const handleMouseDown = (e) => {
        e.preventDefault();
        if (!isSpectator && status === 'playing' && isMyTurn()) {
            handleShoot();
        }
    };

    const handleMouseUp = (e) => {
        e.preventDefault();
        if (!isSpectator && status === 'playing' && isMyTurn()) {
            handleRelease();
        }
    };

    return (
        <div className="flex flex-col items-center p-4 bg-blue-50 min-h-screen">
            <h1 className="text-3xl font-bold mb-4">
                Shoot The Target - {isSpectator ? 'Spectating' : 'Multiplayer'}
            </h1>

            <div className="bg-white p-2 rounded-lg shadow-lg">
                <canvas
                    ref={canvasRef}
                    width={CANVAS_WIDTH}
                    height={CANVAS_HEIGHT}
                    onMouseDown={handleMouseDown}
                    onMouseUp={handleMouseUp}
                    className={`border border-gray-300 ${isSpectator ? 'cursor-default' : 'cursor-pointer'}`}
                />
            </div>

            <div className="mt-4 text-center">
                <div className="mb-2">
                    <strong>Status:</strong> {
                        isSpectator ? 'Spectating - ' : ''
                    }{
                        status === 'connecting' ? 'Connecting...' :
                            status === 'waiting' ? 'Waiting for players' :
                                status === 'playing' ? 'Game in progress' :
                                    status === 'gameOver' ? 'Game finished' : 'Error'
                    }
                </div>

                {gameState.gameOver && (
                    <div className="mt-4 text-center text-xl">
                        Returning to home...
                    </div>
                )}

                {!isSpectator && (
                    <div className="text-sm text-gray-600 mt-2">
                        Hold mouse button to charge power, release to shoot
                    </div>
                )}
            </div>
        </div>
    );
}