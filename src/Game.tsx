import { useEffect, useRef, useState } from "react";
import { Row, RowState } from "./Row";
import dictionary from "./dictionary.json";
import { Clue, clue, describeClue, violation } from "./clue";
import { Keyboard } from "./Keyboard";
import targetList from "./targets.json";
import * as $ from 'jquery';
import {
  describeSeed,
  dictionarySet,
  Difficulty,
  gameName,
  pick,
  resetRng,
  seed,
  speak,
  urlParam,
} from "./util";
import { decode, encode } from "./base64";

enum GameState {
  Playing,
  Won,
  Lost,
}

export const gameDayStoragePrefix = "game-day-";
export const guessesDayStoragePrefix = "guesses-day-";
export const numGuessesStorageKey = "num-guesses-day-";
export const numSolvedStorageKey = "num-solved-day-"

function useLocalStorage<T>(
  key: string,
  initial: T
): [T, (value: T | ((t: T) => T)) => void] {
  const [current, setCurrent] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initial;
    } catch (e) {
      return initial;
    }
  });
  const setSetting = (value: T | ((t: T) => T)) => {
    try {
      const v = value instanceof Function ? value(current) : value;
      setCurrent(v);
      window.localStorage.setItem(key, JSON.stringify(v));
    } catch (e) {}
  };
  return [current, setSetting];
}

interface GameProps {
  maxGuesses: number;
  hidden: boolean;
  difficulty: Difficulty;
  colorBlind: boolean;
  keyboardLayout: string;
}

const targets = targetList.slice(0, targetList.indexOf("murky") + 1); // Words no rarer than this one
const minLength = 4;
const defaultLength = 5;
const maxLength = 11;
const limitLength = (n: number) =>
  n >= minLength && n <= maxLength ? n : defaultLength;

function randomTarget(wordLength: number): string {
  const eligible = targets.filter((word) => word.length === wordLength);
  let candidate: string;
  do {
    candidate = pick(eligible);
  } while (/\*/.test(candidate));
  return candidate;
}

function getChallengeUrl(target: string): string {
  return (
    window.location.origin +
    window.location.pathname +
    "?challenge=" +
    encode(target)
  );
}

let initChallenge = "";
let challengeError = false;
try {
  initChallenge = decode(urlParam("challenge") ?? "").toLowerCase();
} catch (e) {
  console.warn(e);
  challengeError = true;
}
if (initChallenge && !dictionarySet.has(initChallenge)) {
  initChallenge = "";
  challengeError = true;
}

function parseUrlLength(): number {
  const lengthParam = urlParam("length");
  if (!lengthParam) return defaultLength;
  return limitLength(Number(lengthParam));
}

function parseUrlGameNumber(): number {
  const gameParam = urlParam("game");
  if (!gameParam) return 1;
  const gameNumber = Number(gameParam);
  return gameNumber >= 1 && gameNumber <= 1000 ? gameNumber : 1;
}


function calc_to_next(steps: number): number{
  return 1000 - (steps - (Math.trunc(steps / 1000) * 1000) )
}

function calc_available(steps: number): number{
  return Math.trunc(steps/1000)
}

function Game(props: GameProps) {

  let stateStorageKey = (gameDayStoragePrefix+seed);
  let guessesStorageKey = (guessesDayStoragePrefix+seed);

  const [gameState, setGameState] = useLocalStorage<GameState>(stateStorageKey, GameState.Playing);
  const [guesses, setGuesses] = useLocalStorage<string[]>(guessesStorageKey, []);

  const [steps, setSteps] = useState<number>(0);
  const [num_guesses, set_num_guesses] = useLocalStorage<number>(numGuessesStorageKey, 0);
  const [solved, set_solved] = useLocalStorage<number>(numSolvedStorageKey, 0);

  const [to_next_guess, set_to_next_guess] = useState(calc_to_next(steps))
  const [guesses_available, set_guesses_available] = useState(calc_available(steps))
  
  const [currentGuess, setCurrentGuess] = useState<string>("");
  const [challenge, setChallenge] = useState<string>(initChallenge);
  const [wordLength, setWordLength] = useState(
    challenge ? challenge.length : parseUrlLength()
  );
  const [gameNumber, setGameNumber] = useState(parseUrlGameNumber());
  const [target, setTarget] = useState(() => {
    resetRng();
    // Skip RNG ahead to the parsed initial game number:
    for (let i = 1; i < gameNumber; i++) randomTarget(wordLength);
    return challenge || randomTarget(wordLength);
  });
  const [hint, setHint] = useState<string>(
    challengeError
      ? `Invalid challenge string, playing random game.`
      : `Make your first guess!`
  );

  hitFitbit();
  
  const currentSeedParams = () =>
    `?seed=${seed}&length=${wordLength}&game=${gameNumber}`;
  useEffect(() => {
    if (seed) {
      window.history.replaceState(
        {},
        document.title,
        window.location.pathname + currentSeedParams()
      );
    }
  }, [wordLength, gameNumber]);
  const tableRef = useRef<HTMLTableElement>(null);
  const startNextGame = () => {
    if (challenge) {
      // Clear the URL parameters:
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    setChallenge("");
    const newWordLength = limitLength(wordLength);
    setWordLength(newWordLength);
    setTarget(randomTarget(newWordLength));
    setHint("");
    setGuesses([]);
    setCurrentGuess("");
    setGameState(GameState.Playing);
    setGameNumber((x) => x + 1);
  };
  function hitFitbit(){
    $.ajax({
      url: 'https://www.imjs.dev/fitbit/steps_simple',
      success:(data: any)=>{
        setSteps(data);
        set_to_next_guess(calc_to_next(data))
        set_guesses_available(calc_available(data))
      }
  })}

  async function share(copiedHint: string, text?: string) {
    const url = seed
      ? window.location.origin + window.location.pathname + currentSeedParams()
      : getChallengeUrl(target);
    const body = url + (text ? "\n\n" + text : "");
    if (
      /android|iphone|ipad|ipod|webos/i.test(navigator.userAgent) &&
      !/firefox/i.test(navigator.userAgent)
    ) {
      try {
        await navigator.share({ text: body });
        return;
      } catch (e) {
        console.warn("navigator.share failed:", e);
      }
    }
    try {
      await navigator.clipboard.writeText(body);
      setHint(copiedHint);
      return;
    } catch (e) {
      console.warn("navigator.clipboard.writeText failed:", e);
    }
    setHint(url);
  }

  const onKey = (key: string) => {
    if (gameState !== GameState.Playing) {
      if (key === "Enter") {
        startNextGame();
      }
      return;
    }
    if (guesses.length === props.maxGuesses) return;
    if (/^[a-z]$/i.test(key)) {
      setCurrentGuess((guess) =>
        (guess + key.toLowerCase()).slice(0, wordLength)
      );
      tableRef.current?.focus();
      setHint("");
    } else if (key === "Backspace") {
      setCurrentGuess((guess) => guess.slice(0, -1));
      setHint("");
    } else if (key === "Enter") {
      if (currentGuess.length !== wordLength) {
        setHint("Too short");
        return;
      }
      if (!dictionary.includes(currentGuess)) {
        setHint("Not a valid word");
        return;
      }
      if (num_guesses>=guesses_available){
        setHint(`Out of guesses ${num_guesses} ${guesses_available} ${steps}`);
        return;
      }

      for (const g of guesses) {
        const c = clue(g, target);
        const feedback = violation(props.difficulty, c, currentGuess);
        if (feedback) {
          setHint(feedback);
          return;
        }
      }
      setGuesses((guesses) => guesses.concat([currentGuess]));
      setCurrentGuess((guess) => "");
      set_num_guesses(num_guesses+1);

      const gameOver = (verbed: string) =>
        `You ${verbed}! The answer was ${target.toUpperCase()}. (Enter to ${
          challenge ? "play a random game" : "play again"
        })`;

      if (currentGuess === target) {
        setHint(gameOver("won"));
        setGameState(GameState.Won);
        set_solved(solved+1);
      } else if (guesses.length + 1 === props.maxGuesses) {
        setHint(gameOver("lost"));
        setGameState(GameState.Lost);
      } else {
        setHint("");
        speak(describeClue(clue(currentGuess, target)));
      }
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) {
        onKey(e.key);
      }
      if (e.key === "Backspace") {
        e.preventDefault();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [currentGuess, gameState]);

  let letterInfo = new Map<string, Clue>();
  const tableRows = Array(props.maxGuesses)
    .fill(undefined)
    .map((_, i) => {
      const guess = [...guesses, currentGuess][i] ?? "";
      const cluedLetters = clue(guess, target);
      const lockedIn = i < guesses.length;
      if (lockedIn) {
        for (const { clue, letter } of cluedLetters) {
          if (clue === undefined) break;
          const old = letterInfo.get(letter);
          if (old === undefined || clue > old) {
            letterInfo.set(letter, clue);
          }
        }
      }
      return (
        <Row
          key={i}
          wordLength={wordLength}
          rowState={
            lockedIn
              ? RowState.LockedIn
              : i === guesses.length
              ? RowState.Editing
              : RowState.Pending
          }
          cluedLetters={cluedLetters}
        />
      );
    });

  return (
    <div className="Game" style={{ display: props.hidden ? "none" : "block" }}>
      <div className="Game-options">
        <label htmlFor="wordLength">Letters:</label>
        <input
          type="range"
          min={minLength}
          max={maxLength}
          id="wordLength"
          disabled={
            gameState === GameState.Playing &&
            (guesses.length > 0 || currentGuess !== "" || challenge !== "")
          }
          value={wordLength}
          onChange={(e) => {
            const length = Number(e.target.value);
            resetRng();
            setGameNumber(1);
            setGameState(GameState.Playing);
            setGuesses([]);
            setCurrentGuess("");
            setTarget(randomTarget(length));
            setWordLength(length);
            setHint(`${length} letters`);
          }}
        ></input>
        <button
          style={{ flex: "0 0 auto" }}
          disabled={gameState !== GameState.Playing || guesses.length === 0}
          onClick={() => {
            setHint(
              `The answer was ${target.toUpperCase()}. (Enter to play again)`
            );
            setGameState(GameState.Lost);
            (document.activeElement as HTMLElement)?.blur();
          }}
        >
          Give up
        </button>
      </div>
      <table
        className="Game-rows"
        tabIndex={0}
        aria-label="Table of guesses"
        ref={tableRef}
      >
        <tbody>{tableRows}</tbody>
      </table>
      <p
        role="alert"
        style={{
          userSelect: /https?:/.test(hint) ? "text" : "none",
          whiteSpace: "pre-wrap",
        }}
      >
        {hint || `\u00a0`}
      </p>
      <Keyboard
        layout={props.keyboardLayout}
        letterInfo={letterInfo}
        onKey={onKey}
      />
      <div className="Game-seed-info">
        {challenge
          ? "playing a challenge game"
          : seed
          ? `${describeSeed(seed)} — length ${wordLength}, game ${gameNumber}`
          : "playing a random game"}
      </div>
      <div className="Step-info">
          Steps Taken: {steps} ({to_next_guess} till next guess)
      </div>
      <div className="Guess-info">
          Guesses Used: {num_guesses}/{Math.trunc(steps/1000)}
      </div>
      <div className="Solved-info">Solved: </div>     
      <p>
        <button
          onClick={() => {
            share("Link copied to clipboard!");
          }}
        >
          Share a link to this game
        </button>{" "}
        {gameState !== GameState.Playing && (
          <button
            onClick={() => {
              const emoji = props.colorBlind
                ? ["⬛", "🟦", "🟧"]
                : ["⬛", "🟨", "🟩"];
              const score = gameState === GameState.Lost ? "X" : guesses.length;
              share(
                "Result copied to clipboard!",
                `${gameName} ${score}/${props.maxGuesses}\n` +
                  guesses
                    .map((guess) =>
                      clue(guess, target)
                        .map((c) => emoji[c.clue ?? 0])
                        .join("")
                    )
                    .join("\n")
              );
            }}
          >
            Share emoji results
          </button>
        )}
      </p>
    </div>
  );
}

export default Game;
