import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { database, ref, set, onValue, update, remove, onDisconnect, push, child } from "../../firebase";
import { auth, db } from '../../firebase';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

export default function AgeOfWarsGame() {
    const location = useLocation();
    const navigate = useNavigate();
    const { lobbyId, players: lobbyPlayers, isHost } = location.state || {};

    const canvasRef = useRef(null);
    const gameLoopRef = useRef(null);

    // Use current user ID instead of random playerId
    const [playerId] = useState(() => auth.currentUser?.uid || null);
    const [gameId, setGameId] = useState(lobbyId);
    const [playerNumber, setPlayerNumber] = useState(null);
    const [username, setUsername] = useState('');
    const [status, setStatus] = useState('connecting');

    const [gameState, setGameState] = useState({
        players: [],
        playerResources: {},
        playerBases: {},
        units: [],
        projectiles: [],
        gameTime: 0,
        gameStartTime: null,
        battleStarted: false,
        gameOver: false,
        winner: null
    });

    const BASE_ELO_CHANGE = 20;
    const navigateTimeoutRef = useRef(null);

    const CANVAS_WIDTH = 1000;
    const CANVAS_HEIGHT = 600;
    const BASE_WIDTH = 200;
    const BASE_HEIGHT = 400;
    const GROUND_Y = 480;

    // Unit types with their properties and sprites
    const UNIT_TYPES = {
        hooligan: {
            name: 'Hooligan',
            cost: 50,
            hp: 100,
            damage: 20,
            speed: 2,
            range: 20,
            size: 128,
            color: '#8B4513',
            sprites: {
                walk: {
                    src: `${process.env.PUBLIC_URL}/Games/age_of_wars/Images/Hooligan/Walk.png`,
                    frames: 7,
                    frameWidth: 128,
                    frameHeight: 128
                },
                attack: {
                    src: `${process.env.PUBLIC_URL}/Games/age_of_wars/Images/Hooligan/Attack.png`,
                    frames: 5,
                    frameWidth: 128,
                    frameHeight: 128
                },
                dead: {
                    src: `${process.env.PUBLIC_URL}/Games/age_of_wars/Images/Hooligan/Dead.png`,
                    frames: 4,
                    frameWidth: 128,
                    frameHeight: 128
                }
            }
        },
        shooter: {
            name: 'Shooter',
            cost: 75,
            hp: 60,
            damage: 15,
            speed: 1.7,
            range: 150,
            size: 128,
            color: '#228B22',
            sprites: {
                walk: {
                    src: `${process.env.PUBLIC_URL}/Games/age_of_wars/Images/Shooter/Walk.png`,
                    frames: 8,
                    frameWidth: 128,
                    frameHeight: 128
                },
                attack: {
                    src: `${process.env.PUBLIC_URL}/Games/age_of_wars/Images/Shooter/Attack.png`,
                    frames: 5,
                    frameWidth: 128,
                    frameHeight: 128
                },
                dead: {
                    src: `${process.env.PUBLIC_URL}/Games/age_of_wars/Images/Shooter/Dead.png`,
                    frames: 5,
                    frameWidth: 128,
                    frameHeight: 128
                }
            }
        },
        knight: {
            name: 'Knight',
            cost: 120,
            hp: 200,
            damage: 40,
            speed: 1.2,
            range: 25,
            size: 128,
            color: '#4169E1',
            sprites: {
                walk: {
                    src: `${process.env.PUBLIC_URL}/Games/age_of_wars/Images/Knight/Walk.png`,
                    frames: 8,
                    frameWidth: 128,
                    frameHeight: 128
                },
                attack: {
                    src: `${process.env.PUBLIC_URL}/Games/age_of_wars/Images/Knight/Attack.png`,
                    frames: 5,
                    frameWidth: 128,
                    frameHeight: 128
                },
                dead: {
                    src: `${process.env.PUBLIC_URL}/Games/age_of_wars/Images/Knight/Dead.png`,
                    frames: 6,
                    frameWidth: 128,
                    frameHeight: 128
                }
            }
        }
    };

    // Preload images (units + environment)
    const [unitImages, setUnitImages] = useState({});
    const [environmentImages, setEnvironmentImages] = useState({});

    useEffect(() => {
        const loadImages = async () => {
            // Load unit images
            const unitImgs = {};
            for (const [unitType, unit] of Object.entries(UNIT_TYPES)) {
                unitImgs[unitType] = {};
                for (const [state, spriteData] of Object.entries(unit.sprites)) {
                    const img = new Image();
                    img.onload = () => {
                        console.log(`Loaded: ${unitType} ${state}`);
                    };
                    img.onerror = () => {
                        console.error(`Failed to load: ${spriteData.src}`);
                    };
                    img.src = spriteData.src;
                    unitImgs[unitType][state] = img;
                }
            }
            setUnitImages(unitImgs);

            // Load environment images
            const envImgs = {
                background: new Image(),
                bullet: new Image(),
                towers: {
                    player1: {
                        full: new Image(),
                        mid: new Image(),
                        low: new Image()
                    },
                    player2: {
                        full: new Image(),
                        mid: new Image(),
                        low: new Image()
                    }
                }
            };

            // Background
            envImgs.background.src = `${process.env.PUBLIC_URL}/Games/age_of_wars/Images/View/Background.png`;
            envImgs.background.onload = () => console.log('Background loaded');
            envImgs.background.onerror = () => console.error('Failed to load background');

            // Bullet image
            envImgs.bullet.src = `${process.env.PUBLIC_URL}/Games/age_of_wars/Images/Shooter/bullet.png`;
            envImgs.bullet.onload = () => console.log('Bullet image loaded');
            envImgs.bullet.onerror = () => console.error('Failed to load bullet image');

            // Player 1 towers
            envImgs.towers.player1.full.src = `${process.env.PUBLIC_URL}/Games/age_of_wars/Images/View/Player1/full_hp_tower.png`;
            envImgs.towers.player1.mid.src = `${process.env.PUBLIC_URL}/Games/age_of_wars/Images/View/Player1/mid_hp_tower.png`;
            envImgs.towers.player1.low.src = `${process.env.PUBLIC_URL}/Games/age_of_wars/Images/View/Player1/low_hp_tower.png`;

            // Player 2 towers
            envImgs.towers.player2.full.src = `${process.env.PUBLIC_URL}/Games/age_of_wars/Images/View/Player2/full_hp_tower.png`;
            envImgs.towers.player2.mid.src = `${process.env.PUBLIC_URL}/Games/age_of_wars/Images/View/Player2/mid_hp_tower.png`;
            envImgs.towers.player2.low.src = `${process.env.PUBLIC_URL}/Games/age_of_wars/Images/View/Player2/low_hp_tower.png`;

            // Add load handlers for towers
            Object.values(envImgs.towers.player1).forEach((img, i) => {
                img.onload = () => console.log(`Player 1 tower ${['full', 'mid', 'low'][i]} loaded`);
                img.onerror = () => console.error(`Failed to load Player 1 tower ${['full', 'mid', 'low'][i]}`);
            });
            Object.values(envImgs.towers.player2).forEach((img, i) => {
                img.onload = () => console.log(`Player 2 tower ${['full', 'mid', 'low'][i]} loaded`);
                img.onerror = () => console.error(`Failed to load Player 2 tower ${['full', 'mid', 'low'][i]}`);
            });

            setEnvironmentImages(envImgs);
            console.log('All images loading initiated');
        };
        loadImages();
    }, []);

    // Helper function to get tower image based on HP percentage
    const getTowerImage = (playerNumber, hpPercent) => {
        const playerKey = playerNumber === 0 ? 'player1' : 'player2';
        const towers = environmentImages.towers?.[playerKey];

        if (!towers) return null;

        if (hpPercent > 0.66) {
            return towers.full;
        } else if (hpPercent > 0.33) {
            return towers.mid;
        } else {
            return towers.low;
        }
    };

    // Initialize game when component mounts
    useEffect(() => {
        if (!lobbyId || !auth.currentUser) {
            navigate('/');
            return;
        }

        // Fetch username and initialize game
        const initializeGame = async () => {
            try {
                setStatus('connecting');

                // Get username from Firestore
                const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
                let playerUsername = 'Unknown Player';

                if (userDoc.exists()) {
                    const userData = userDoc.data();
                    playerUsername = userData.username || userData.email || 'Unknown Player';
                }

                setUsername(playerUsername);

                if (isHost) {
                    await createGame(playerUsername);
                } else {
                    await joinGame(playerUsername);
                }

            } catch (error) {
                console.error('Error initializing game:', error);
                setStatus('error');
            }
        };

        initializeGame();
    }, [lobbyId, lobbyPlayers, isHost, navigate]);

    const updateEloForPlayers = async (winnerId) => {
        try {
            // Update ELO for all players
            for (const player of gameState.players) {
                const userId = player.id;
                const isWinner = userId === winnerId;
                const eloChange = isWinner ? BASE_ELO_CHANGE : -BASE_ELO_CHANGE;

                const userRef = doc(db, 'users', userId);
                const userDoc = await getDoc(userRef);

                if (userDoc.exists()) {
                    const userData = userDoc.data();
                    const currentStats = userData.stats || {};
                    const currentElo = currentStats.aowElo || 1000;

                    await updateDoc(userRef, {
                        'stats.aowElo': Math.max(0, currentElo + eloChange) // Prevent negative ELO
                    });

                    console.log(`Updated ELO for ${player.username}: ${currentElo} -> ${currentElo + eloChange} (${eloChange > 0 ? '+' : ''}${eloChange})`);
                } else {
                    // Create new user stats if they don't exist
                    await setDoc(userRef, {
                        stats: {
                            aowElo: Math.max(0, 1000 + eloChange)
                        }
                    }, { merge: true });

                    console.log(`Created new ELO for ${player.username}: 1000 -> ${1000 + eloChange} (${eloChange > 0 ? '+' : ''}${eloChange})`);
                }
            }
        } catch (error) {
            console.error('Error updating ELO:', error);
        }
    };

    const createGame = async (playerUsername) => {
        try {
            const initialGameState = {
                players: [{ id: playerId, username: playerUsername, number: 0 }],
                playerResources: { [playerId]: 100 },
                playerBases: {
                    [playerId]: {
                        hp: 2000,
                        maxHp: 2000,
                        x: 50,
                        y: GROUND_Y - BASE_HEIGHT,
                        side: 'left'
                    }
                },
                units: [],
                projectiles: [],
                gameTime: 0,
                gameStartTime: null,
                battleStarted: false,
                gameOver: false,
                winner: null,
                createdAt: Date.now()
            };

            // Set game state
            await set(ref(database, `games/age_of_wars/${gameId}`), initialGameState);

            setPlayerNumber(0);
            setStatus('waiting');

            console.log('Created game:', gameId);
        } catch (error) {
            console.error('Error creating game:', error);
            setStatus('error');
        }
    };

    const joinGame = async (playerUsername) => {
        try {
            // Get current game state
            const gameRef = ref(database, `games/age_of_wars/${gameId}`);

            onValue(gameRef, async (snapshot) => {
                const currentGame = snapshot.val();
                if (currentGame && currentGame.players.length < 2) {
                    const playerNum = currentGame.players.length;

                    // Add player to game
                    const updatedPlayers = [
                        ...currentGame.players,
                        { id: playerId, username: playerUsername, number: playerNum }
                    ];

                    const updatedResources = {
                        ...currentGame.playerResources,
                        [playerId]: 100
                    };

                    const updatedBases = {
                        ...currentGame.playerBases,
                        [playerId]: {
                            hp: 2000,
                            maxHp: 2000,
                            x: CANVAS_WIDTH - 50 - BASE_WIDTH,
                            y: GROUND_Y - BASE_HEIGHT,
                            side: 'right'
                        }
                    };

                    await update(ref(database, `games/age_of_wars/${gameId}`), {
                        players: updatedPlayers,
                        playerResources: updatedResources,
                        playerBases: updatedBases
                    });

                    setPlayerNumber(playerNum);
                    setStatus('playing');

                    console.log('Joined game:', gameId);
                }
            }, { onlyOnce: true });

        } catch (error) {
            console.error('Error joining game:', error);
            setStatus('error');
        }
    };

    const deployUnit = async (unitType) => {
        console.log('Deploy unit called:', unitType);
        console.log('Current status:', status);
        console.log('Player resources:', gameState.playerResources[playerId]);
        console.log('Unit cost:', UNIT_TYPES[unitType].cost);

        if (status !== 'playing' || !gameState.playerResources[playerId] ||
            gameState.playerResources[playerId] < UNIT_TYPES[unitType].cost) {
            console.log('Cannot deploy unit - insufficient resources or wrong status');
            return;
        }

        try {
            const unitTemplate = UNIT_TYPES[unitType];
            const isLeftSide = playerNumber === 0;

            const newUnit = {
                id: `unit_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                type: unitType,
                playerId: playerId,
                side: isLeftSide ? 'left' : 'right',
                x: isLeftSide ? 150 : CANVAS_WIDTH - 150,
                y: GROUND_Y - unitTemplate.size,
                hp: unitTemplate.hp,
                maxHp: unitTemplate.hp,
                damage: unitTemplate.damage,
                speed: unitTemplate.speed,
                range: unitTemplate.range,
                size: unitTemplate.size,
                color: unitTemplate.color,
                target: null,
                lastAttack: 0,
                moving: true,
                state: 'walk',
                isAttacking: false,
                animationFrame: 0,
                lastFrameTime: 0,
                deathTime: null
            };

            console.log('Created new unit:', newUnit);

            const updatedUnits = [...(gameState.units || []), newUnit];
            const updatedResources = {
                ...gameState.playerResources,
                [playerId]: gameState.playerResources[playerId] - unitTemplate.cost
            };

            // Start timer on first unit deployment
            const updates = {
                units: updatedUnits,
                playerResources: updatedResources
            };

            if (!gameState.battleStarted) {
                updates.battleStarted = true;
                updates.gameStartTime = Date.now();
            }

            console.log('Updating Firebase with new unit and resources');

            await update(ref(database, `games/age_of_wars/${gameId}`), updates);

            console.log('Firebase update successful');

        } catch (error) {
            console.error('Error deploying unit:', error);
        }
    };

    // Listen to game state changes
    useEffect(() => {
        if (!gameId) return;

        const gameRef = ref(database, `games/age_of_wars/${gameId}`);
        const unsubscribe = onValue(gameRef, async (snapshot) => {
            const data = snapshot.val();
            if (data) {
                setGameState(data);

                if (data.players.length === 2 && status === 'waiting') {
                    setStatus('playing');
                }

                if (data.gameOver) {
                    setStatus('gameOver');

                    // Update ELO when game ends
                    if (data.winner && data.winner !== 'draw') {
                        await updateEloForPlayers(data.winner);
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
    }, [gameId, status]);

    // Game logic loop (only for player 0 to avoid conflicts)
    useEffect(() => {
        if (status !== 'playing' || playerNumber !== 0) return;

        const gameLogicLoop = async () => {
            if (!gameState.units) return;

            console.log(`Game logic running - Player ${playerNumber}, Units: ${gameState.units.length}`);

            let updatedUnits = [...(gameState.units || [])];
            let updatedProjectiles = [...(gameState.projectiles || [])];
            let updatedBases = { ...gameState.playerBases };
            let gameEnded = false;
            let winner = null;

            const currentTime = Date.now();

            // Check for timer end (3.5 minutes = 210000ms) - only if battle has started
            if (gameState.battleStarted && gameState.gameStartTime) {
                const timeElapsed = currentTime - gameState.gameStartTime;
                const timeLimit = 210000; // 3.5 minutes

                if (timeElapsed >= timeLimit && !gameState.gameOver) {
                    // Time's up - it's a draw
                    const updates = {
                        gameOver: true,
                        winner: 'draw',
                        gameTime: currentTime
                    };
                    try {
                        await update(ref(database, `games/age_of_wars/${gameId}`), updates);
                    } catch (error) {
                        console.error('Error updating game with draw:', error);
                    }
                    return;
                }
            }

            // NEW: Track melee damage to apply after unit processing
            const meleeDamageQueue = [];

            // Update units
            updatedUnits = updatedUnits.map(unit => {
                if (unit.hp <= 0 && !unit.deathTime) {
                    // Just died - start death animation
                    unit.state = 'dead';
                    unit.deathTime = currentTime;
                    unit.animationFrame = 0;
                    return unit;
                } else if (unit.hp <= 0 && unit.deathTime) {
                    // Already dead - continue death animation
                    if (currentTime - unit.lastFrameTime > 200) { // Slower death animation
                        const spriteData = UNIT_TYPES[unit.type].sprites[unit.state];
                        if (unit.animationFrame < spriteData.frames - 1) {
                            unit.animationFrame++;
                            unit.lastFrameTime = currentTime;
                        }
                    }
                    return unit;
                }

                const unitType = UNIT_TYPES[unit.type];
                const isLeftSide = unit.side === 'left';

                // Update animation frame for living units
                if (currentTime - unit.lastFrameTime > 150) { // Change frame every 150ms
                    const spriteData = unitType.sprites[unit.state];
                    unit.animationFrame = (unit.animationFrame + 1) % spriteData.frames;
                    unit.lastFrameTime = currentTime;
                }

                // Find targets
                const enemies = updatedUnits.filter(u =>
                    u && u.playerId !== unit.playerId && u.hp > 0
                );

                console.log(`Unit ${unit.id} (${unit.type}) looking for enemies:`, enemies.length);

                const enemyBase = Object.entries(updatedBases).find(([pid, base]) =>
                    pid !== unit.playerId
                )?.[1];

                let target = null;
                let targetDistance = Infinity;

                // Find closest enemy unit
                enemies.forEach(enemy => {
                    const dist = Math.abs(enemy.x - unit.x);
                    if (dist < targetDistance && dist <= unit.range) {
                        target = enemy;
                        targetDistance = dist;
                        console.log(`Unit ${unit.id} found target ${enemy.id} at distance ${dist}`);
                    }
                });

                // If no enemy units in range, target enemy base
                if (!target && enemyBase) {
                    const baseDistance = Math.abs(
                        (enemyBase.x + BASE_WIDTH / 2) - unit.x
                    );
                    // Different attack ranges for different unit types when attacking bases
                    let baseAttackRange;
                    if (unit.range > 50) {
                        // Ranged units (shooters) attack from much further away
                        baseAttackRange = unit.range + 100; // Add 100 pixels for ranged units
                    } else {
                        // Melee units can get closer
                        baseAttackRange = unit.range + 60;
                    }

                    if (baseDistance <= baseAttackRange) {
                        target = 'base';
                        targetDistance = baseDistance;
                    }
                }

                if (target && target !== 'base') {
                    // Attack enemy unit - STOP MOVING
                    unit.isAttacking = true;
                    unit.state = 'attack';
                    console.log(`Unit ${unit.id} attacking target ${target.id}, last attack: ${currentTime - unit.lastAttack}ms ago`);

                    if (currentTime - unit.lastAttack > 1500) { // Attack speed -> every 1.5 seconds
                        console.log(`Unit ${unit.id} executing attack on ${target.id}`);
                        if (unit.range > 50) {
                            // Ranged unit - create projectile (KEEP UNCHANGED)
                            console.log(`Creating projectile from ${unit.id}`);

                            const rifleOffsetX = unit.side === 'left' ? 30 : -30;
                            const rifleOffsetY = 25;

                            updatedProjectiles.push({
                                id: `proj_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                                x: unit.x + rifleOffsetX,
                                y: unit.y + unit.size / 2 + rifleOffsetY,
                                direction: unit.side === 'left' ? 1 : -1,
                                damage: unit.damage,
                                speed: 8,
                                playerId: unit.playerId,
                                maxDistance: unit.range + 50
                            });
                        } else {
                            // NEW: Queue melee damage instead of applying immediately
                            console.log(`Queueing melee damage: ${unit.damage} from ${unit.id} to ${target.id}`);
                            meleeDamageQueue.push({
                                targetId: target.id,
                                damage: unit.damage,
                                attackerId: unit.id
                            });
                        }
                        unit.lastAttack = currentTime;
                    }
                } else if (target === 'base') {
                    // Attack enemy base - STOP MOVING
                    unit.isAttacking = true;
                    unit.state = 'attack';
                    if (currentTime - unit.lastAttack > 1000) {
                        const enemyPlayerId = Object.keys(updatedBases).find(pid => pid !== unit.playerId);
                        if (enemyPlayerId) {
                            if (unit.range > 50) {
                                // Ranged unit attacking base - create projectile
                                console.log(`Creating projectile from ${unit.id} to attack base`);

                                const rifleOffsetX = unit.side === 'left' ? 30 : -30;
                                const rifleOffsetY = 40;

                                updatedProjectiles.push({
                                    id: `proj_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                                    x: unit.x + rifleOffsetX,
                                    y: unit.y + unit.size / 2 + rifleOffsetY,
                                    direction: unit.side === 'left' ? 1 : -1,
                                    damage: unit.damage,
                                    speed: 8,
                                    playerId: unit.playerId,
                                    maxDistance: unit.range + 120, // Longer distance for base attacks
                                    targetType: 'base' // Mark this as targeting a base
                                });
                            } else {
                                // Melee unit - direct damage to base
                                updatedBases[enemyPlayerId] = {
                                    ...updatedBases[enemyPlayerId],
                                    hp: updatedBases[enemyPlayerId].hp - unit.damage
                                };

                                if (updatedBases[enemyPlayerId].hp <= 0) {
                                    gameEnded = true;
                                    winner = unit.playerId;
                                }
                            }
                        }
                        unit.lastAttack = currentTime;
                    }
                } else {
                    // Move towards enemy base - KEEP MOVING
                    unit.isAttacking = false;
                    unit.state = 'walk';
                    const moveDirection = isLeftSide ? 1 : -1;
                    unit.x += unit.speed * moveDirection;
                }

                return unit;
            }).filter(unit => {
                // Remove dead units after death animation completes (2 seconds)
                if (unit && unit.hp <= 0 && unit.deathTime && currentTime - unit.deathTime > 2000) {
                    return false;
                }
                return unit !== null;
            });

            // NEW: Apply all queued melee damage after unit processing
            meleeDamageQueue.forEach(damage => {
                const targetIndex = updatedUnits.findIndex(u => u && u.id === damage.targetId && u.hp > 0);
                if (targetIndex !== -1) {
                    console.log(`Applying queued melee damage: ${damage.damage} from ${damage.attackerId} to ${damage.targetId}`);
                    updatedUnits[targetIndex] = {
                        ...updatedUnits[targetIndex],
                        hp: Math.max(0, updatedUnits[targetIndex].hp - damage.damage)
                    };
                    console.log(`After damage: ${updatedUnits[targetIndex].id} has ${updatedUnits[targetIndex].hp} HP`);
                } else {
                    console.log(`Target ${damage.targetId} not found or already dead when applying queued damage`);
                }
            });

            // Update projectiles - SIMPLIFIED SYSTEM
            updatedProjectiles = updatedProjectiles.map(proj => {
                // Move bullet in straight line
                proj.x += proj.speed * proj.direction;
                proj.maxDistance -= proj.speed;

                // Remove bullet if it traveled too far
                if (proj.maxDistance <= 0) {
                    return null;
                }

                // Check collision with enemy units - SIMPLER HITBOX
                const hitUnit = updatedUnits.find(unit =>
                    unit &&
                    unit.playerId !== proj.playerId &&
                    unit.hp > 0 &&
                    Math.abs(unit.x - proj.x) < 40 && // Wider horizontal hitbox
                    Math.abs(unit.y + unit.size / 2 - proj.y) < 30 // Vertical hitbox
                );

                if (hitUnit) {
                    // Apply damage to hit unit
                    const unitIndex = updatedUnits.findIndex(u => u.id === hitUnit.id);
                    if (unitIndex !== -1) {
                        updatedUnits[unitIndex] = {
                            ...updatedUnits[unitIndex],
                            hp: updatedUnits[unitIndex].hp - proj.damage
                        };
                        console.log(`Bullet hit ${hitUnit.id} for ${proj.damage} damage!`);
                    }
                    return null; // Remove bullet after hit
                }

                // Check collision with enemy base if this projectile targets bases
                if (proj.targetType === 'base') {
                    const enemyPlayerId = Object.keys(updatedBases).find(pid => pid !== proj.playerId);
                    if (enemyPlayerId) {
                        const enemyBase = updatedBases[enemyPlayerId];
                        // Check if bullet hits the base area
                        if (proj.x >= enemyBase.x - 20 &&
                            proj.x <= enemyBase.x + BASE_WIDTH + 20 &&
                            proj.y >= enemyBase.y &&
                            proj.y <= enemyBase.y + BASE_HEIGHT) {

                            // Apply damage to base
                            updatedBases[enemyPlayerId] = {
                                ...updatedBases[enemyPlayerId],
                                hp: updatedBases[enemyPlayerId].hp - proj.damage
                            };

                            console.log(`Bullet hit base for ${proj.damage} damage!`);

                            if (updatedBases[enemyPlayerId].hp <= 0) {
                                gameEnded = true;
                                winner = proj.playerId;
                            }

                            return null; // Remove bullet after hitting base
                        }
                    }
                }

                return proj;
            }).filter(proj => proj !== null);

            // Update resources (passive income) - 3x slower
            const updatedResources = { ...gameState.playerResources };
            Object.keys(updatedResources).forEach(pid => {
                // Only increment every 3rd game loop (150ms instead of 50ms = 3x slower)
                if (currentTime % 3 === 0) {
                    updatedResources[pid] = Math.min(updatedResources[pid] + 1, 999);
                }
            });

            const updates = {
                units: updatedUnits,
                projectiles: updatedProjectiles,
                playerBases: updatedBases,
                playerResources: updatedResources,
                gameTime: currentTime
            };

            if (gameEnded) {
                updates.gameOver = true;
                updates.winner = winner;
            }

            try {
                await update(ref(database, `games/age_of_wars/${gameId}`), updates);
            } catch (error) {
                console.error('Error updating game logic:', error);
            }
        };

        const intervalId = setInterval(gameLogicLoop, 50); // Run every 50ms
        return () => clearInterval(intervalId);
    }, [status, gameState, gameId, playerNumber]);

    // Draw game
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');

        const draw = () => {
            // Clear canvas
            ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

            // Draw background image or fallback
            if (environmentImages.background && environmentImages.background.complete && environmentImages.background.naturalWidth !== 0) {
                // Scale and center the background image to fit the canvas
                const bgImg = environmentImages.background;
                const imgAspect = bgImg.naturalWidth / bgImg.naturalHeight;
                const canvasAspect = CANVAS_WIDTH / CANVAS_HEIGHT;

                let drawWidth, drawHeight, drawX, drawY;

                if (imgAspect > canvasAspect) {
                    // Image is wider than canvas - fit to height
                    drawHeight = CANVAS_HEIGHT;
                    drawWidth = CANVAS_HEIGHT * imgAspect;
                    drawX = (CANVAS_WIDTH - drawWidth) / 2;
                    drawY = 0;
                } else {
                    // Image is taller than canvas - fit to width
                    drawWidth = CANVAS_WIDTH;
                    drawHeight = CANVAS_WIDTH / imgAspect;
                    drawX = 0;
                    drawY = (CANVAS_HEIGHT - drawHeight) / 2;
                }

                ctx.drawImage(bgImg, drawX, drawY, drawWidth, drawHeight);
            } else {
                // Fallback to solid colors
                // Draw sky
                ctx.fillStyle = '#87CEEB';
                ctx.fillRect(0, 0, CANVAS_WIDTH, GROUND_Y);

                // Draw ground
                ctx.fillStyle = '#8B4513';
                ctx.fillRect(0, GROUND_Y, CANVAS_WIDTH, CANVAS_HEIGHT - GROUND_Y);
            }

            // Draw bases with tower textures
            Object.entries(gameState.playerBases || {}).forEach(([pid, base]) => {
                const player = gameState.players.find(p => p.id === pid);
                if (!player) return;

                const baseHpPercent = base.hp / base.maxHp;
                const towerImage = getTowerImage(player.number, baseHpPercent);

                if (towerImage && towerImage.complete && towerImage.naturalWidth !== 0) {
                    // Calculate tower position and size
                    let towerWidth = BASE_WIDTH;
                    let towerHeight = BASE_HEIGHT;
                    let towerX = base.x;
                    let towerY = base.y;

                    // Adjust size based on actual image dimensions if needed
                    const imageAspect = towerImage.naturalWidth / towerImage.naturalHeight;
                    const currentAspect = BASE_WIDTH / BASE_HEIGHT;

                    if (imageAspect !== currentAspect) {
                        // Maintain aspect ratio
                        if (imageAspect > currentAspect) {
                            // Image is wider - fit to width
                            towerHeight = BASE_WIDTH / imageAspect;
                            towerY = base.y + (BASE_HEIGHT - towerHeight) / 2;
                        } else {
                            // Image is taller - fit to height
                            towerWidth = BASE_HEIGHT * imageAspect;
                            towerX = base.x + (BASE_WIDTH - towerWidth) / 2;
                        }
                    }

                    ctx.drawImage(towerImage, towerX, towerY, towerWidth, towerHeight);
                } else {
                    // Fallback to colored rectangle
                    ctx.fillStyle = player.number === 0 ? '#4169E1' : '#DC143C';
                    ctx.fillRect(base.x, base.y, BASE_WIDTH, BASE_HEIGHT);
                }

                // Base HP bar
                const hpBarPercent = base.hp / base.maxHp;
                ctx.fillStyle = 'red';
                ctx.fillRect(base.x, base.y - 20, BASE_WIDTH, 10);
                ctx.fillStyle = 'green';
                ctx.fillRect(base.x, base.y - 20, BASE_WIDTH * hpBarPercent, 10);

                // Base HP text with background
                const hpText = `${Math.max(0, Math.floor(base.hp))}/${base.maxHp}`;
                ctx.font = '12px Arial';
                ctx.textAlign = 'center';

                // Measure text to create background
                const textMetrics = ctx.measureText(hpText);
                const textWidth = textMetrics.width;
                const textHeight = 12;
                const bgX = base.x + BASE_WIDTH / 2 - textWidth / 2 - 4;
                const bgY = base.y - 25 - textHeight + 2;

                // Semi-transparent background
                ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
                ctx.fillRect(bgX, bgY, textWidth + 8, textHeight + 4);

                // White text
                ctx.fillStyle = 'white';
                ctx.fillText(hpText, base.x + BASE_WIDTH / 2, base.y - 25);
            });

            // Draw units with sprites
            (gameState.units || []).forEach(unit => {
                const player = gameState.players.find(p => p.id === unit.playerId);
                if (!player) return;

                // Get the appropriate sprite
                const unitType = unit.type;
                const state = unit.hp <= 0 ? 'dead' : (unit.state || 'walk');
                const image = unitImages[unitType] && unitImages[unitType][state];
                const spriteData = UNIT_TYPES[unitType].sprites[state];

                if (image && image.complete && image.naturalWidth !== 0) {
                    // Calculate which frame to show
                    const frameIndex = unit.animationFrame || 0;
                    const frameWidth = spriteData.frameWidth;
                    const frameHeight = spriteData.frameHeight;
                    const sourceX = frameIndex * frameWidth;

                    // Draw sprite frame
                    const flipHorizontal = unit.side === 'right';

                    ctx.save();
                    if (flipHorizontal) {
                        ctx.scale(-1, 1);
                        ctx.drawImage(
                            image,
                            sourceX, 0, frameWidth, frameHeight, // Source rectangle
                            -(unit.x + unit.size / 2), unit.y, unit.size, unit.size // Destination rectangle
                        );
                    } else {
                        ctx.drawImage(
                            image,
                            sourceX, 0, frameWidth, frameHeight, // Source rectangle
                            unit.x - unit.size / 2, unit.y, unit.size, unit.size // Destination rectangle
                        );
                    }
                    ctx.restore();
                } else {
                    // Fallback to colored rectangle
                    ctx.fillStyle = unit.color;
                    ctx.fillRect(unit.x - unit.size / 2, unit.y, unit.size, unit.size);
                }

                // Only show health bar for living units
                if (unit.hp > 0) {
                    // Unit HP bar - smaller and closer to unit with black border
                    const hpPercent = unit.hp / unit.maxHp;
                    const barWidth = unit.size * 0.6; // 60% of unit width instead of 100%
                    const barHeight = 4; // Thinner bar
                    const barY = unit.y + 20; // Position it lower, just above the character

                    // Adjust X position for Knight and Hooligan based on their side
                    let barX = unit.x - barWidth / 2; // Center the bar on the unit
                    if (unit.type === 'knight') {
                        if (unit.side === 'left') {
                            barX -= 25; // Move left-side Knight's health bar to the left
                        } else {
                            barX += 25; // Move right-side Knight's health bar to the right
                        }
                    } else if (unit.type === 'hooligan') {
                        if (unit.side === 'left') {
                            barX -= 5; // Move left-side Hooligan's health bar slightly left
                        } else {
                            barX += 5; // Move right-side Hooligan's health bar slightly right
                        }
                    }

                    // Black border around health bar
                    ctx.fillStyle = 'black';
                    ctx.fillRect(barX - 1, barY - 1, barWidth + 2, barHeight + 2);

                    // Red background (full bar)
                    ctx.fillStyle = 'red';
                    ctx.fillRect(barX, barY, barWidth, barHeight);

                    // Green foreground (current HP)
                    ctx.fillStyle = 'green';
                    ctx.fillRect(barX, barY, barWidth * hpPercent, barHeight);
                }
            });

            // Draw projectiles - SIMPLIFIED (no rotation, just straight bullet image)
            (gameState.projectiles || []).forEach(proj => {
                const bulletImage = environmentImages.bullet;

                if (bulletImage && bulletImage.complete && bulletImage.naturalWidth !== 0) {
                    // Scale down the 1280x1280 image to a reasonable bullet size
                    const bulletSize = 16; // Smaller bullet size
                    ctx.drawImage(
                        bulletImage,
                        proj.x - bulletSize / 2, // Center the bullet horizontally
                        proj.y - bulletSize / 2, // Center the bullet vertically
                        bulletSize,
                        bulletSize
                    );
                } else {
                    // Fallback to golden circle if image fails to load
                    ctx.fillStyle = '#FFD700';
                    ctx.beginPath();
                    ctx.arc(proj.x, proj.y, 3, 0, Math.PI * 2);
                    ctx.fill();
                }
            });

            // Draw UI
            if (status === 'waiting') {
                // Centered waiting message
                ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
                ctx.fillRect(CANVAS_WIDTH / 2 - 100, 15, 200, 30);
                ctx.fillStyle = '#FFF';
                ctx.font = '16px Arial';
                ctx.textAlign = 'center';
                ctx.fillText('Waiting for opponent...', CANVAS_WIDTH / 2, 35);
            } else if (status === 'playing') {
                // Beautiful centered resource display at top
                const resourceBoxWidth = 400;
                const resourceBoxHeight = 50;
                const resourceBoxX = (CANVAS_WIDTH - resourceBoxWidth) / 2;
                const resourceBoxY = 10;

                // Background box with border
                ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
                ctx.fillRect(resourceBoxX, resourceBoxY, resourceBoxWidth, resourceBoxHeight);
                ctx.strokeStyle = '#FFD700';
                ctx.lineWidth = 2;
                ctx.strokeRect(resourceBoxX, resourceBoxY, resourceBoxWidth, resourceBoxHeight);

                // Resource text styling
                ctx.font = 'bold 18px Arial';
                ctx.textAlign = 'center';

                // Draw each player's resources with matching tower colors
                gameState.players.forEach((player, i) => {
                    const resources = gameState.playerResources[player.id] || 0;
                    const textX = resourceBoxX + (i + 1) * (resourceBoxWidth / (gameState.players.length + 1));
                    const textY = resourceBoxY + 30;

                    // Player color coding to match towers
                    if (player.number === 0) {
                        ctx.fillStyle = '#DC143C'; // Red for player 1 (left side)
                    } else {
                        ctx.fillStyle = '#4169E1'; // Blue for player 2 (right side)  
                    }

                    // Cool castle emoji + text with coin emoji
                    ctx.fillText(`🏰 ${player.username}: ${resources} 🪙`, textX, textY);
                });

                // Timer display under resources - only show if battle started
                if (gameState.battleStarted && gameState.gameStartTime) {
                    const timeElapsed = Date.now() - gameState.gameStartTime;
                    const timeLimit = 210000; // 3.5 minutes
                    const timeRemaining = Math.max(0, timeLimit - timeElapsed);
                    const minutes = Math.floor(timeRemaining / 60000);
                    const seconds = Math.floor((timeRemaining % 60000) / 1000);
                    const timeText = `${minutes}:${seconds.toString().padStart(2, '0')}`;

                    // Timer background
                    const timerBoxWidth = 120;
                    const timerBoxHeight = 30;
                    const timerBoxX = (CANVAS_WIDTH - timerBoxWidth) / 2;
                    const timerBoxY = resourceBoxY + resourceBoxHeight + 10;

                    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
                    ctx.fillRect(timerBoxX, timerBoxY, timerBoxWidth, timerBoxHeight);
                    ctx.strokeStyle = '#FFD700';
                    ctx.lineWidth = 2;
                    ctx.strokeRect(timerBoxX, timerBoxY, timerBoxWidth, timerBoxHeight);

                    // Timer text
                    ctx.font = 'bold 16px Arial';
                    ctx.textAlign = 'center';
                    ctx.fillStyle = timeRemaining < 30000 ? '#FF4444' : '#FFD700'; // Red when < 30 seconds
                    ctx.fillText(`⏰ ${timeText}`, timerBoxX + timerBoxWidth / 2, timerBoxY + 20);
                } else if (status === 'playing') {
                    // Show "Deploy first unit to start timer" message
                    const timerBoxWidth = 200;
                    const timerBoxHeight = 30;
                    const timerBoxX = (CANVAS_WIDTH - timerBoxWidth) / 2;
                    const timerBoxY = resourceBoxY + resourceBoxHeight + 10;

                    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
                    ctx.fillRect(timerBoxX, timerBoxY, timerBoxWidth, timerBoxHeight);
                    ctx.strokeStyle = '#888888';
                    ctx.lineWidth = 2;
                    ctx.strokeRect(timerBoxX, timerBoxY, timerBoxWidth, timerBoxHeight);

                    ctx.font = '12px Arial';
                    ctx.textAlign = 'center';
                    ctx.fillStyle = '#CCCCCC';
                    ctx.fillText('Deploy first unit to start timer', timerBoxX + timerBoxWidth / 2, timerBoxY + 20);
                }

                // Beautiful unit deployment panel
                if (playerNumber !== null) {
                    const panelWidth = 350;
                    const panelHeight = 90;
                    const panelX = (CANVAS_WIDTH - panelWidth) / 2;
                    const panelY = CANVAS_HEIGHT - panelHeight - 10;

                    // Gradient background
                    const gradient = ctx.createLinearGradient(panelX, panelY, panelX, panelY + panelHeight);
                    gradient.addColorStop(0, 'rgba(30, 30, 50, 0.95)');
                    gradient.addColorStop(1, 'rgba(20, 20, 40, 0.95)');
                    ctx.fillStyle = gradient;
                    ctx.fillRect(panelX, panelY, panelWidth, panelHeight);

                    // Golden border with glow effect
                    ctx.shadowColor = '#FFD700';
                    ctx.shadowBlur = 10;
                    ctx.strokeStyle = '#FFD700';
                    ctx.lineWidth = 3;
                    ctx.strokeRect(panelX, panelY, panelWidth, panelHeight);
                    ctx.shadowBlur = 0;

                    // Title with emoji
                    ctx.fillStyle = '#FFD700';
                    ctx.font = 'bold 16px Arial';
                    ctx.textAlign = 'center';
                    ctx.fillText('⚔️ Deploy Army ⚔️', panelX + panelWidth / 2, panelY + 25);

                    // Unit buttons with emojis and better styling
                    const unitEmojis = {
                        hooligan: '🗡️',
                        shooter: '🔫',
                        knight: '🛡️'
                    };

                    Object.entries(UNIT_TYPES).forEach(([key, unit], i) => {
                        const buttonWidth = 90;
                        const buttonHeight = 45;
                        const spacing = 10;
                        const startX = panelX + (panelWidth - (buttonWidth * 3 + spacing * 2)) / 2;
                        const x = startX + i * (buttonWidth + spacing);
                        const y = panelY + 35;
                        const canAfford = (gameState.playerResources[playerId] || 0) >= unit.cost;

                        // Button gradient
                        const buttonGradient = ctx.createLinearGradient(x, y, x, y + buttonHeight);
                        if (canAfford) {
                            buttonGradient.addColorStop(0, '#4CAF50');
                            buttonGradient.addColorStop(1, '#2E7D32');
                        } else {
                            buttonGradient.addColorStop(0, '#757575');
                            buttonGradient.addColorStop(1, '#424242');
                        }
                        ctx.fillStyle = buttonGradient;
                        ctx.fillRect(x, y, buttonWidth, buttonHeight);

                        // Button border
                        ctx.strokeStyle = canAfford ? '#81C784' : '#9E9E9E';
                        ctx.lineWidth = 2;
                        ctx.strokeRect(x, y, buttonWidth, buttonHeight);

                        // Unit emoji
                        ctx.font = '20px Arial';
                        ctx.textAlign = 'center';
                        ctx.fillStyle = 'white';
                        ctx.fillText(unitEmojis[key], x + buttonWidth / 2, y + 20);

                        // Unit name and cost
                        ctx.font = 'bold 10px Arial';
                        ctx.fillStyle = 'white';
                        ctx.fillText(`${unit.name}`, x + buttonWidth / 2, y + 30);
                        ctx.font = '9px Arial';
                        ctx.fillStyle = '#FFD700';
                        ctx.fillText(`💰${unit.cost}g`, x + buttonWidth / 2, y + 42);
                    });
                }
            } else if (status === 'gameOver') {
                // Beautiful Game Over screen
                const overlayWidth = 500;
                const overlayHeight = 200;
                const overlayX = (CANVAS_WIDTH - overlayWidth) / 2;
                const overlayY = (CANVAS_HEIGHT - overlayHeight) / 2;

                // Semi-transparent overlay
                ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
                ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

                // Game over box with gradient
                const gameOverGradient = ctx.createLinearGradient(overlayX, overlayY, overlayX, overlayY + overlayHeight);
                gameOverGradient.addColorStop(0, 'rgba(30, 30, 50, 0.95)');
                gameOverGradient.addColorStop(1, 'rgba(20, 20, 40, 0.95)');
                ctx.fillStyle = gameOverGradient;
                ctx.fillRect(overlayX, overlayY, overlayWidth, overlayHeight);

                // Golden glowing border
                ctx.shadowColor = '#FFD700';
                ctx.shadowBlur = 15;
                ctx.strokeStyle = '#FFD700';
                ctx.lineWidth = 4;
                ctx.strokeRect(overlayX, overlayY, overlayWidth, overlayHeight);
                ctx.shadowBlur = 0;

                // Game Over title
                ctx.font = 'bold 36px Arial';
                ctx.textAlign = 'center';
                ctx.fillStyle = '#FF4444';
                ctx.fillText('⚔️ BATTLE OVER ⚔️', CANVAS_WIDTH / 2, overlayY + 60);

                // Winner or Draw message
                ctx.font = 'bold 24px Arial';
                if (gameState.winner === 'draw') {
                    ctx.fillStyle = '#FFD700';
                    ctx.fillText('🤝 DRAW - TIME\'S UP! 🤝', CANVAS_WIDTH / 2, overlayY + 100);
                } else {
                    const winner = gameState.players.find(p => p.id === gameState.winner);
                    if (winner) {
                        const winnerColor = winner.number === 0 ? '#DC143C' : '#4169E1';
                        ctx.fillStyle = winnerColor;
                        ctx.fillText(`🏆 WINNER: ${winner.username.toUpperCase()} 🏆`, CANVAS_WIDTH / 2, overlayY + 100);
                    }
                }

                // Subtitle
                ctx.font = '16px Arial';
                ctx.fillStyle = '#CCCCCC';
                ctx.fillText('Returning to lobby in 10 seconds...', CANVAS_WIDTH / 2, overlayY + 140);
            }
        };

        draw();
        gameLoopRef.current = requestAnimationFrame(draw);

        return () => {
            if (gameLoopRef.current) {
                cancelAnimationFrame(gameLoopRef.current);
            }
        };
    }, [gameState, status, playerNumber, playerId, unitImages, environmentImages]);

    // Handle unit deployment clicks
    const handleCanvasClick = (e) => {
        if (status !== 'playing') {
            console.log('Not playing, status:', status);
            return;
        }

        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        console.log('Click at:', x, y);

        // Check if clicking on unit buttons (updated coordinates to match new centered layout)
        const panelWidth = 350;
        const panelHeight = 90;
        const panelX = (CANVAS_WIDTH - panelWidth) / 2;
        const panelY = CANVAS_HEIGHT - panelHeight - 10;
        const buttonWidth = 90;
        const buttonHeight = 45;
        const spacing = 10;
        const startX = panelX + (panelWidth - (buttonWidth * 3 + spacing * 2)) / 2;
        const buttonY = panelY + 35;

        if (y >= buttonY && y <= buttonY + buttonHeight) {
            console.log('Clicked in unit button area');
            Object.entries(UNIT_TYPES).forEach(([key, unit], i) => {
                const buttonX = startX + i * (buttonWidth + spacing);
                if (x >= buttonX && x <= buttonX + buttonWidth) {
                    const canAfford = (gameState.playerResources[playerId] || 0) >= unit.cost;
                    console.log(`Clicked ${key}, can afford: ${canAfford}, resources: ${gameState.playerResources[playerId]}`);
                    if (canAfford) {
                        console.log(`Deploying ${key}`);
                        deployUnit(key);
                    }
                }
            });
        }
    };

    // Navigate back to lobby when game ends
    useEffect(() => {
        if (status === 'gameOver') {
            const timeout = setTimeout(() => {
                navigate('/');
            }, 10000); // 10 seconds to match the other timeout

            return () => clearTimeout(timeout);
        }
    }, [status, navigate]);

    // Show error if not properly initialized
    if (!lobbyId || !auth.currentUser) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-blue-50">
                <div className="bg-white p-8 rounded-lg shadow-lg">
                    <h1 className="text-2xl font-bold mb-4 text-red-600">Error</h1>
                    <p className="mb-4">Game not properly initialized. Please return to the lobby.</p>
                    <button
                        onClick={() => navigate('/')}
                        className="bg-blue-500 text-white py-2 px-4 rounded-lg hover:bg-blue-600 transition-colors"
                    >
                        Return to Home
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col items-center p-4 bg-blue-50 min-h-screen">
            <h1 className="text-3xl font-bold mb-4">Age of Wars - Battle Arena</h1>
            <p className="mb-2 text-lg">Welcome, <strong>{username}</strong>!</p>

            <div className="bg-white p-2 rounded-lg shadow-lg">
                <canvas
                    ref={canvasRef}
                    width={CANVAS_WIDTH}
                    height={CANVAS_HEIGHT}
                    onClick={handleCanvasClick}
                    className="border border-gray-300 cursor-pointer"
                />
            </div>

            <div className="mt-4 text-center">
                <div className="mb-2">
                    <strong>Status:</strong> {
                        status === 'connecting' ? 'Connecting...' :
                            status === 'waiting' ? 'Waiting for opponent' :
                                status === 'playing' ? 'Battle in progress' :
                                    status === 'gameOver' ? 'Battle finished' : 'Error'
                    }
                </div>

                <div className="text-sm text-gray-600 mt-2">
                    Click unit buttons to deploy troops. Destroy the enemy base to win!
                </div>
            </div>
        </div>
    );
}