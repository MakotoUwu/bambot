import React, { useState, useEffect, useRef, useCallback } from 'react';
import { UpdateJointsDegrees, UpdateJointsSpeed } from '@/hooks/useRobotControl';
import { RobotConfig } from '@/config/robotConfig';
import { radiansToDegrees } from '@/lib/utils';
import { JointDetails } from './RobotLoader';

type GamepadControlProps = {
  updateJointsDegrees: UpdateJointsDegrees;
  updateJointsSpeed: UpdateJointsSpeed;
  keyboardControlMap: RobotConfig['keyboardControlMap'];
  compoundMovements?: RobotConfig['compoundMovements'];
  joints: any[];
  jointDetails: JointDetails[];
  onControlModeChange?: (mode: ControlMode) => void;
  speedMultiplier?: number;
};

type GamepadState = {
  connected: boolean;
  connectionType: 'usb' | 'bluetooth' | 'unknown';
  gamepad: Gamepad | null;
};

type ControlMode = 'keyboard' | 'gamepad';

const GAMEPAD_UPDATE_INTERVAL = 16; // ~60fps
const GAMEPAD_DEADZONE = 0.1;
const BASE_GAMEPAD_SENSITIVITY = 0.30; // Match keyboard base speed (doubled for faster response)
const BASE_GAMEPAD_BUTTON_STEP = 2.0; // Base step for button presses (doubled for faster response)
const GAMEPAD_BUTTON_HOLD_STEP = 0.5; // Slower step for held button presses
const BUTTON_RAMP_UP_TIME = 500; // Time in ms to reach full speed
const MIN_BUTTON_STEP = 0.1; // Minimum step size for smooth start

// PS5 DualSense button mapping
const PS5_BUTTONS = {
  X: 0,
  CIRCLE: 1,
  SQUARE: 2,
  TRIANGLE: 3,
  L1: 4,
  R1: 5,
  L2: 6,
  R2: 7,
  SHARE: 8,
  OPTIONS: 9,
  L3: 10,
  R3: 11,
  DPAD_UP: 12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15,
  PS: 16,
  TOUCHPAD: 17
};

// PS5 DualSense axis mapping
const PS5_AXES = {
  LEFT_STICK_X: 0,
  LEFT_STICK_Y: 1,
  RIGHT_STICK_X: 2,
  RIGHT_STICK_Y: 3
};

export function GamepadControl({
  updateJointsDegrees,
  updateJointsSpeed,
  keyboardControlMap,
  compoundMovements,
  joints,
  jointDetails,
  onControlModeChange,
  speedMultiplier = 1
}: GamepadControlProps) {
  // Calculate actual sensitivity based on speed multiplier
  const GAMEPAD_SENSITIVITY = BASE_GAMEPAD_SENSITIVITY * speedMultiplier;
  const GAMEPAD_BUTTON_STEP = BASE_GAMEPAD_BUTTON_STEP * speedMultiplier;
  const [controlMode, setControlMode] = useState<ControlMode>('keyboard');
  const [gamepadState, setGamepadState] = useState<GamepadState>({
    connected: false,
    connectionType: 'unknown',
    gamepad: null
  });
  
  const gamepadIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const previousButtonStates = useRef<boolean[]>([]);
  const buttonHoldStartTime = useRef<{ [key: number]: number }>({});
  const jointsRef = useRef(joints);
  const keyboardControlMapRef = useRef(keyboardControlMap);
  const compoundMovementsRef = useRef(compoundMovements);

  // Update refs when props change
  useEffect(() => {
    jointsRef.current = joints;
  }, [joints]);

  useEffect(() => {
    keyboardControlMapRef.current = keyboardControlMap;
  }, [keyboardControlMap]);

  useEffect(() => {
    compoundMovementsRef.current = compoundMovements;
  }, [compoundMovements]);

  // Detect gamepad connection type
  const detectConnectionType = useCallback((gamepad: Gamepad): 'usb' | 'bluetooth' | 'unknown' => {
    // PS5 DualSense detection
    if (gamepad.id.toLowerCase().includes('dualsense') || 
        gamepad.id.toLowerCase().includes('054c:0ce6')) {
      // Check if it's connected via USB or Bluetooth
      // USB connections typically have different vibration capabilities
      if (gamepad.vibrationActuator) {
        return 'usb';
      }
      return 'bluetooth';
    }
    return 'unknown';
  }, []);

  // Handle gamepad connection events
  useEffect(() => {
    const handleGamepadConnected = (event: GamepadEvent) => {
      const gamepad = event.gamepad;
      const connectionType = detectConnectionType(gamepad);
      
      setGamepadState({
        connected: true,
        connectionType,
        gamepad
      });
      
      console.log(`Gamepad connected: ${gamepad.id} via ${connectionType}`);
    };

    const handleGamepadDisconnected = (event: GamepadEvent) => {
      setGamepadState({
        connected: false,
        connectionType: 'unknown',
        gamepad: null
      });
      
      console.log(`Gamepad disconnected: ${event.gamepad.id}`);
    };

    window.addEventListener('gamepadconnected', handleGamepadConnected);
    window.addEventListener('gamepaddisconnected', handleGamepadDisconnected);

    // Check for already connected gamepads
    const gamepads = navigator.getGamepads();
    for (const gamepad of gamepads) {
      if (gamepad) {
        handleGamepadConnected({ gamepad } as GamepadEvent);
        break;
      }
    }

    return () => {
      window.removeEventListener('gamepadconnected', handleGamepadConnected);
      window.removeEventListener('gamepaddisconnected', handleGamepadDisconnected);
    };
  }, [detectConnectionType]);

  // Apply deadzone to axis values
  const applyDeadzone = useCallback((value: number): number => {
    return Math.abs(value) < GAMEPAD_DEADZONE ? 0 : value;
  }, []);

  // Map gamepad input to robot control
  const processGamepadInput = useCallback(() => {
    const gamepads = navigator.getGamepads();
    const gamepad = gamepads[0]; // Use first gamepad
    
    if (!gamepad || controlMode !== 'gamepad') return;

    const currentJoints = jointsRef.current;
    const currentControlMap = keyboardControlMapRef.current || {};
    const currentCompoundMovements = compoundMovementsRef.current || [];

    // Handle button presses for discrete movements
    const currentButtonStates = Array.from(gamepad.buttons, button => button.pressed);
    
    // Check for button state changes (press/release)
    for (let i = 0; i < currentButtonStates.length; i++) {
      const wasPressed = previousButtonStates.current[i] || false;
      const isPressed = currentButtonStates[i];
      
      if (isPressed && !wasPressed) {
        // Button just pressed - record start time
        buttonHoldStartTime.current[i] = Date.now();
        handleButtonPress(i, false);
      } else if (isPressed && wasPressed) {
        // Button is being held - continue movement with ramped speed
        handleButtonPress(i, true);
      } else if (!isPressed && wasPressed) {
        // Button released - clear hold time
        delete buttonHoldStartTime.current[i];
      }
    }
    
    previousButtonStates.current = currentButtonStates;

    // Handle analog stick movements for continuous control
    const leftStickX = applyDeadzone(gamepad.axes[PS5_AXES.LEFT_STICK_X]);
    const leftStickY = applyDeadzone(gamepad.axes[PS5_AXES.LEFT_STICK_Y]);
    const rightStickX = applyDeadzone(gamepad.axes[PS5_AXES.RIGHT_STICK_X]);
    const rightStickY = applyDeadzone(gamepad.axes[PS5_AXES.RIGHT_STICK_Y]);

    // Map analog sticks to joint movements
    const updates: { servoId: number; value: number }[] = [];
    
    // Left stick controls base rotation (servo 1) and pitch (servo 2)
    if (leftStickX !== 0) {
      const baseJoint = currentJoints.find(j => j.servoId === 1);
      if (baseJoint) {
        const currentDegrees = baseJoint.virtualDegrees || 0;
        let newValue = currentDegrees + (leftStickX * GAMEPAD_SENSITIVITY);
        
        // Apply joint limits
        const joint = jointDetails.find(j => j.servoId === 1);
        if (joint?.limit) {
          const lowerLimit = Math.round(
            radiansToDegrees(joint.limit?.lower ?? -Infinity)
          );
          const upperLimit = Math.round(
            radiansToDegrees(joint.limit?.upper ?? Infinity)
          );
          newValue = Math.max(lowerLimit, Math.min(upperLimit, newValue));
        }
        
        updates.push({ servoId: 1, value: newValue });
      }
    }
    
    if (leftStickY !== 0) {
      const pitchJoint = currentJoints.find(j => j.servoId === 2);
      if (pitchJoint) {
        const currentDegrees = pitchJoint.virtualDegrees || 0;
        let newValue = currentDegrees + (-leftStickY * GAMEPAD_SENSITIVITY);
        
        // Apply joint limits
        const joint = jointDetails.find(j => j.servoId === 2);
        if (joint?.limit) {
          const lowerLimit = Math.round(
            radiansToDegrees(joint.limit?.lower ?? -Infinity)
          );
          const upperLimit = Math.round(
            radiansToDegrees(joint.limit?.upper ?? Infinity)
          );
          newValue = Math.max(lowerLimit, Math.min(upperLimit, newValue));
        }
        
        updates.push({ servoId: 2, value: newValue });
      }
    }
    
    // Right stick controls elbow (servo 3) and wrist pitch (servo 4)
    if (rightStickX !== 0) {
      const elbowJoint = currentJoints.find(j => j.servoId === 3);
      if (elbowJoint) {
        const currentDegrees = elbowJoint.virtualDegrees || 0;
        let newValue = currentDegrees + (rightStickX * GAMEPAD_SENSITIVITY);
        
        // Apply joint limits
        const joint = jointDetails.find(j => j.servoId === 3);
        if (joint?.limit) {
          const lowerLimit = Math.round(
            radiansToDegrees(joint.limit?.lower ?? -Infinity)
          );
          const upperLimit = Math.round(
            radiansToDegrees(joint.limit?.upper ?? Infinity)
          );
          newValue = Math.max(lowerLimit, Math.min(upperLimit, newValue));
        }
        
        updates.push({ servoId: 3, value: newValue });
      }
    }
    
    if (rightStickY !== 0) {
      const wristJoint = currentJoints.find(j => j.servoId === 4);
      if (wristJoint) {
        const currentDegrees = wristJoint.virtualDegrees || 0;
        let newValue = currentDegrees + (-rightStickY * GAMEPAD_SENSITIVITY);
        
        // Apply joint limits
        const joint = jointDetails.find(j => j.servoId === 4);
        if (joint?.limit) {
          const lowerLimit = Math.round(
            radiansToDegrees(joint.limit?.lower ?? -Infinity)
          );
          const upperLimit = Math.round(
            radiansToDegrees(joint.limit?.upper ?? Infinity)
          );
          newValue = Math.max(lowerLimit, Math.min(upperLimit, newValue));
        }
        
        updates.push({ servoId: 4, value: newValue });
      }
    }

    // Apply updates if any
    if (updates.length > 0) {
      updateJointsDegrees(updates);
    }
  }, [controlMode, applyDeadzone, updateJointsDegrees]);

  // Handle discrete button presses
  const handleButtonPress = useCallback((buttonIndex: number, isHeld: boolean = false) => {
    const currentJoints = jointsRef.current;
    let stepSize = isHeld ? GAMEPAD_BUTTON_HOLD_STEP : GAMEPAD_BUTTON_STEP;
    
    // Apply smooth ramp-up for held buttons
    if (isHeld) {
      const holdTime = Date.now() - (buttonHoldStartTime.current[buttonIndex] || Date.now());
      const rampProgress = Math.min(holdTime / BUTTON_RAMP_UP_TIME, 1);
      stepSize = MIN_BUTTON_STEP + (GAMEPAD_BUTTON_HOLD_STEP - MIN_BUTTON_STEP) * rampProgress;
    }
    
    switch (buttonIndex) {
      case PS5_BUTTONS.L1:
        // Wrist roll left (servo 5)
        const wristRollJoint = currentJoints.find(j => j.servoId === 5);
        if (wristRollJoint) {
          const currentDegrees = wristRollJoint.virtualDegrees || 0;
          let newValue = currentDegrees - stepSize;
          
          // Apply joint limits
          const joint = jointDetails.find(j => j.servoId === 5);
          if (joint?.limit) {
            const lowerLimit = Math.round(
              radiansToDegrees(joint.limit?.lower ?? -Infinity)
            );
            const upperLimit = Math.round(
              radiansToDegrees(joint.limit?.upper ?? Infinity)
            );
            newValue = Math.max(lowerLimit, Math.min(upperLimit, newValue));
          }
          
          updateJointsDegrees([{ servoId: 5, value: newValue }]);
        }
        break;
      case PS5_BUTTONS.R1:
        // Wrist roll right (servo 5)
        const wristRollJoint2 = currentJoints.find(j => j.servoId === 5);
        if (wristRollJoint2) {
          const currentDegrees = wristRollJoint2.virtualDegrees || 0;
          let newValue = currentDegrees + stepSize;
          
          // Apply joint limits
          const joint = jointDetails.find(j => j.servoId === 5);
          if (joint?.limit) {
            const lowerLimit = Math.round(
              radiansToDegrees(joint.limit?.lower ?? -Infinity)
            );
            const upperLimit = Math.round(
              radiansToDegrees(joint.limit?.upper ?? Infinity)
            );
            newValue = Math.max(lowerLimit, Math.min(upperLimit, newValue));
          }
          
          updateJointsDegrees([{ servoId: 5, value: newValue }]);
        }
        break;
      case PS5_BUTTONS.L2:
        // Close jaw (servo 6)
        const jawJoint = currentJoints.find(j => j.servoId === 6);
        if (jawJoint) {
          const currentDegrees = jawJoint.virtualDegrees || 0;
          let newValue = currentDegrees - stepSize;
          
          // Apply joint limits
          const joint = jointDetails.find(j => j.servoId === 6);
          if (joint?.limit) {
            const lowerLimit = Math.round(
              radiansToDegrees(joint.limit?.lower ?? -Infinity)
            );
            const upperLimit = Math.round(
              radiansToDegrees(joint.limit?.upper ?? Infinity)
            );
            newValue = Math.max(lowerLimit, Math.min(upperLimit, newValue));
          }
          
          updateJointsDegrees([{ servoId: 6, value: newValue }]);
        }
        break;
      case PS5_BUTTONS.R2:
        // Open jaw (servo 6)
        const jawJoint2 = currentJoints.find(j => j.servoId === 6);
        if (jawJoint2) {
          const currentDegrees = jawJoint2.virtualDegrees || 0;
          let newValue = currentDegrees + stepSize;
          
          // Apply joint limits
          const joint = jointDetails.find(j => j.servoId === 6);
          if (joint?.limit) {
            const lowerLimit = Math.round(
              radiansToDegrees(joint.limit?.lower ?? -Infinity)
            );
            const upperLimit = Math.round(
              radiansToDegrees(joint.limit?.upper ?? Infinity)
            );
            newValue = Math.max(lowerLimit, Math.min(upperLimit, newValue));
          }
          
          updateJointsDegrees([{ servoId: 6, value: newValue }]);
        }
        break;
      // Add more button mappings as needed
    }
  }, [updateJointsDegrees]);

  // Start/stop gamepad polling
  useEffect(() => {
    if (controlMode === 'gamepad' && gamepadState.connected) {
      gamepadIntervalRef.current = setInterval(processGamepadInput, GAMEPAD_UPDATE_INTERVAL);
    } else {
      if (gamepadIntervalRef.current) {
        clearInterval(gamepadIntervalRef.current);
        gamepadIntervalRef.current = null;
      }
    }

    return () => {
      if (gamepadIntervalRef.current) {
        clearInterval(gamepadIntervalRef.current);
      }
    };
  }, [controlMode, gamepadState.connected, processGamepadInput]);

  const getConnectionStatusColor = () => {
    if (!gamepadState.connected) return 'text-red-500';
    return gamepadState.connectionType === 'bluetooth' ? 'text-blue-500' : 'text-green-500';
  };

  const getConnectionStatusText = () => {
    if (!gamepadState.connected) return 'Not Connected';
    return gamepadState.connectionType === 'bluetooth' ? 'Bluetooth' : 'USB';
  };

  return (
    <div className="bg-zinc-800 bg-opacity-90 text-white p-4 rounded-lg mb-4">
      <h4 className="font-bold text-sm mb-3 border-b border-zinc-600 pb-1">
        Control Mode
      </h4>
      
      {/* Control Mode Selector */}
      <div className="flex gap-2 mb-3">
        <button
          onClick={() => {
            setControlMode('keyboard');
            onControlModeChange?.('keyboard');
          }}
          className={`px-3 py-1.5 text-xs rounded ${
            controlMode === 'keyboard'
              ? 'bg-blue-600 text-white'
              : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
          }`}
        >
          Keyboard
        </button>
        <button
          onClick={() => {
            setControlMode('gamepad');
            onControlModeChange?.('gamepad');
          }}
          disabled={!gamepadState.connected}
          className={`px-3 py-1.5 text-xs rounded ${
            controlMode === 'gamepad'
              ? 'bg-blue-600 text-white'
              : gamepadState.connected
              ? 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
              : 'bg-zinc-700 text-zinc-500 cursor-not-allowed'
          }`}
        >
          Gamepad
        </button>
      </div>

      {/* Gamepad Status */}
      <div className="text-xs">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-zinc-400">PS5 DualSense:</span>
          <span className={getConnectionStatusColor()}>
            {getConnectionStatusText()}
          </span>
        </div>
        
        {gamepadState.connected && (
          <div className="text-zinc-400 text-xs">
            {gamepadState.gamepad?.id}
          </div>
        )}
      </div>

      {/* Gamepad Controls Help */}
      {controlMode === 'gamepad' && gamepadState.connected && (
        <div className="mt-3 text-xs">
          <div className="font-semibold mb-2 text-zinc-300">Gamepad Controls:</div>
          
          {/* Analog Sticks */}
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="bg-zinc-700 rounded-lg p-2">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-6 h-6 bg-zinc-600 rounded-full border-2 border-zinc-500 flex items-center justify-center">
                  <div className="w-3 h-3 bg-zinc-400 rounded-full"></div>
                </div>
                <span className="text-zinc-300 text-xs font-medium">Left Stick</span>
              </div>
              <div className="text-zinc-400 text-xs">
                <div>↔ Base rotation</div>
                <div>↕ Pitch</div>
              </div>
            </div>
            
            <div className="bg-zinc-700 rounded-lg p-2">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-6 h-6 bg-zinc-600 rounded-full border-2 border-zinc-500 flex items-center justify-center">
                  <div className="w-3 h-3 bg-zinc-400 rounded-full"></div>
                </div>
                <span className="text-zinc-300 text-xs font-medium">Right Stick</span>
              </div>
              <div className="text-zinc-400 text-xs">
                <div>↔ Elbow</div>
                <div>↕ Wrist pitch</div>
              </div>
            </div>
          </div>
          
          {/* Shoulder Buttons */}
          <div className="grid grid-cols-2 gap-2 mb-2">
            <div className="flex items-center gap-2">
              <div className="bg-zinc-600 text-white px-2 py-1 rounded text-xs font-bold min-w-[24px] text-center">
                L1
              </div>
              <span className="text-zinc-400 text-xs">Wrist roll left</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="bg-zinc-600 text-white px-2 py-1 rounded text-xs font-bold min-w-[24px] text-center">
                R1
              </div>
              <span className="text-zinc-400 text-xs">Wrist roll right</span>
            </div>
          </div>
          
          {/* Trigger Buttons */}
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center gap-2">
              <div className="bg-zinc-600 text-white px-2 py-1 rounded text-xs font-bold min-w-[24px] text-center">
                L2
              </div>
              <span className="text-zinc-400 text-xs">Jaw close</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="bg-zinc-600 text-white px-2 py-1 rounded text-xs font-bold min-w-[24px] text-center">
                R2
              </div>
              <span className="text-zinc-400 text-xs">Jaw open</span>
            </div>
          </div>
        </div>
      )}

      {/* Keyboard Controls Help */}
      {controlMode === 'keyboard' && (
        <div className="mt-3 text-xs text-zinc-400">
          <div className="font-semibold mb-1">Keyboard Controls:</div>
          <div>q/1: Base rotation</div>
          <div>i/8: Jaw down/up</div>
          <div>u/o: Jaw backward/forward</div>
          <div>y/6: Jaw close/open</div>
        </div>
      )}
    </div>
  );
}