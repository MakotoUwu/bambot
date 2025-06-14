"use client";
import Oeact, { useState, useEffect, useRef } from "react"; // Added useRef
import {
  JointState,
  UpdateJointDegrees,
  UpdateJointsDegrees,
} from "../../../hooks/useRobotControl";
import { radiansToDegrees } from "../../../lib/utils";
import { RobotConfig } from "@/config/robotConfig";

type RevoluteJointsTableProps = {
  joints: JointState[];
  updateJointDegrees: UpdateJointDegrees;
  updateJointsDegrees: UpdateJointsDegrees;
  keyboardControlMap: RobotConfig["keyboardControlMap"];
  compoundMovements?: RobotConfig["compoundMovements"]; // Use type from robotConfig
  keyboardEnabled?: boolean;
  controlMode?: 'keyboard' | 'gamepad';
  speedMultiplier?: number;
  onSpeedChange?: (speed: number) => void;
};

// Define constants for interval and step size
const KEY_UPDATE_INTERVAL_MS = 3;
const BASE_KEY_UPDATE_STEP_DEGREES = 0.15;

const formatVirtualDegrees = (degrees?: number) =>
  degrees !== undefined
    ? `${degrees > 0 ? "+" : ""}${degrees.toFixed(1)}°`
    : "/";
const formatRealDegrees = (degrees?: number | "N/A" | "error") => {
  if (degrees === "error") {
    return <span className="text-red-500">Error</span>;
  }
  return degrees === "N/A" ? "/" : `${degrees?.toFixed(1)}°`;
};

// compoundMovements 约定：keys[0] 是正向运动，keys[1] 是反向运动
// 例如 keys: ["8", "i"]，"8" 控制正向，"i" 控制反向

// Gamepad button mappings for SO-ARM100
const gamepadControlMap: { [servoId: number]: [string, string] } = {
  1: ['L←', 'L→'], // Base rotation: Left stick X
  2: ['L↑', 'L↓'], // Pitch: Left stick Y  
  3: ['R←', 'R→'], // Elbow: Right stick X
  4: ['R↑', 'R↓'], // Wrist pitch: Right stick Y
  5: ['L1', 'R1'], // Wrist roll: L1/R1 buttons
  6: ['L2', 'R2'], // Jaw: L2/R2 buttons
};

const gamepadCompoundMovements = [
  { name: 'Jaw down & up', keys: ['L2', 'R2'] },
  { name: 'Jaw backward & forward', keys: ['L1', 'R1'] },
];

export function RevoluteJointsTable({
  joints,
  updateJointDegrees,
  updateJointsDegrees,
  keyboardControlMap,
  compoundMovements,
  keyboardEnabled = true,
  controlMode = 'keyboard',
  speedMultiplier = 1.0,
  onSpeedChange,
}: RevoluteJointsTableProps) {
  // Calculate actual step size based on speed multiplier
  const KEY_UPDATE_STEP_DEGREES = BASE_KEY_UPDATE_STEP_DEGREES * speedMultiplier;
  const [pressedKeys, setPressedKeys] = useState<Set<string>>(new Set());
  // Refs to hold the latest values needed inside the interval callback
  const jointsRef = useRef(joints);
  const updateJointsDegreesRef = useRef(updateJointsDegrees);
  const keyboardControlMapRef = useRef(keyboardControlMap);

  // Update refs whenever the props change
  useEffect(() => {
    jointsRef.current = joints;
  }, [joints]);

  useEffect(() => {
    updateJointsDegreesRef.current = updateJointsDegrees;
  }, [updateJointsDegrees]);

  useEffect(() => {
    keyboardControlMapRef.current = keyboardControlMap;
  }, [keyboardControlMap]);

  // Effect for keyboard listeners
  useEffect(() => {
    if (!keyboardEnabled) {
      // Clear pressed keys when keyboard is disabled
      setPressedKeys(new Set());
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      // Check if the pressed key is actually used for control to potentially prevent default
      // Note: Using the ref here ensures we check against the *latest* map
      const isControlKey = Object.values(keyboardControlMapRef.current || {})
        .flat()
        .includes(event.key);
      if (isControlKey) {
        // event.preventDefault(); // Optional: uncomment if keys like arrows scroll the page
      }
      setPressedKeys((prevKeys) => new Set(prevKeys).add(event.key));
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      setPressedKeys((prevKeys) => {
        const newKeys = new Set(prevKeys);
        newKeys.delete(event.key);
        return newKeys;
      });
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    // Cleanup function to remove event listeners
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [keyboardEnabled]); // Add keyboardEnabled to dependency array

  // Effect for handling continuous updates when keys are pressed
  useEffect(() => {
    if (!keyboardEnabled) {
      return;
    }

    let intervalId: NodeJS.Timeout | null = null;

    const updateJointsBasedOnKeys = () => {
      const currentJoints = jointsRef.current;
      const currentControlMap = keyboardControlMapRef.current || {};
      const currentPressedKeys = pressedKeys;
      const currentCompoundMovements = compoundMovements || [];

      // 普通单关节控制
      let updates = currentJoints
        .map((joint) => {
          const decreaseKey = currentControlMap[joint.servoId!]?.[1];
          const increaseKey = currentControlMap[joint.servoId!]?.[0];
          let currentDegrees = joint.virtualDegrees || 0;
          let newValue = currentDegrees;

          if (decreaseKey && currentPressedKeys.has(decreaseKey)) {
            newValue -= KEY_UPDATE_STEP_DEGREES;
          }
          if (increaseKey && currentPressedKeys.has(increaseKey)) {
            newValue += KEY_UPDATE_STEP_DEGREES;
          }

          const lowerLimit = Math.round(
            radiansToDegrees(joint.limit?.lower ?? -Infinity)
          );
          const upperLimit = Math.round(
            radiansToDegrees(joint.limit?.upper ?? Infinity)
          );
          newValue = Math.max(lowerLimit, Math.min(upperLimit, newValue));

          if (newValue !== currentDegrees) {
            return { servoId: joint.servoId!, value: newValue };
          }
          return null;
        })
        .filter((update) => update !== null) as {
        servoId: number;
        value: number;
      }[];

      // 处理 compoundMovements，覆盖普通单关节控制
      currentCompoundMovements.forEach((cm) => {
        // 判断是否有 key 被按下
        // keys[0] 为正向，keys[1] 为反向
        const pressedIdx = cm.keys.findIndex((k) => currentPressedKeys.has(k));
        if (pressedIdx === -1) return;

        // primaryJoint 当前角度
        const primaryJoint = currentJoints.find(
          (j) => j.servoId === cm.primaryJoint
        );
        if (!primaryJoint) return;
        const primary = primaryJoint.virtualDegrees || 0;

        // 取第一个 dependent joint 作为 dependent
        const dependentJointId = cm.dependents[0]?.joint;
        const dependentJoint = currentJoints.find(
          (j) => j.servoId === dependentJointId
        );
        const dependent = dependentJoint?.virtualDegrees || 0;

        // 步进大小总是 KEY_UPDATE_STEP_DEGREES
        // sign 决定方向，正向为 +1，反向为 -1
        let sign = 1;
        if (cm.primaryFormula) {
          try {
            // eslint-disable-next-line no-new-func
            sign =
              Math.sign(
                Function(
                  "primary",
                  "dependent",
                  "delta",
                  `return ${cm.primaryFormula}`
                )(primary, dependent, KEY_UPDATE_STEP_DEGREES)
              ) || 1;
          } catch (e) {
            sign = 1;
          }
        } else {
          sign = pressedIdx === 0 ? 1 : -1;
        }
        // 按键顺序决定 deltaPrimary 正负
        const deltaPrimary =
          KEY_UPDATE_STEP_DEGREES * sign * (pressedIdx === 0 ? 1 : -1);

        // primaryJoint 新值
        let newPrimaryValue = primary + deltaPrimary;
        const lowerLimit = Math.round(
          radiansToDegrees(primaryJoint.limit?.lower ?? -Infinity)
        );
        const upperLimit = Math.round(
          radiansToDegrees(primaryJoint.limit?.upper ?? Infinity)
        );
        newPrimaryValue = Math.max(
          lowerLimit,
          Math.min(upperLimit, newPrimaryValue)
        );

        // 用 Map 方便覆盖
        const updatesMap = new Map<number, number>();
        updates.forEach((u) => updatesMap.set(u.servoId, u.value));
        updatesMap.set(primaryJoint.servoId!, newPrimaryValue);

        // dependents
        cm.dependents.forEach((dep) => {
          const dependentJoint = currentJoints.find(
            (j) => j.servoId === dep.joint
          );
          if (!dependentJoint) return;
          const dependent = dependentJoint.virtualDegrees || 0;
          let deltaDependent = 0;
          try {
            // eslint-disable-next-line no-new-func
            deltaDependent = Function(
              "primary",
              "dependent",
              "deltaPrimary",
              `return ${dep.formula}`
            )(primary, dependent, deltaPrimary);
          } catch (e) {
            deltaDependent = 0;
          }
          // If deltaDependent is not a valid number, set it to 0
          if (!Number.isFinite(deltaDependent)) {
            deltaDependent = 0;
          }
          let newDependentValue = dependent + deltaDependent;
          const depLowerLimit = Math.round(
            radiansToDegrees(dependentJoint.limit?.lower ?? -Infinity)
          );
          const depUpperLimit = Math.round(
            radiansToDegrees(dependentJoint.limit?.upper ?? Infinity)
          );
          newDependentValue = Math.max(
            depLowerLimit,
            Math.min(depUpperLimit, newDependentValue)
          );
          updatesMap.set(dependentJoint.servoId!, newDependentValue);
        });

        // compoundMovements 的 joint 更新覆盖普通单关节控制
        updates = Array.from(updatesMap.entries()).map(([servoId, value]) => ({
          servoId,
          value,
        }));
      });

      if (updates.length > 0) {
        updateJointsDegreesRef.current(updates);
      }
    };

    if (pressedKeys.size > 0) {
      intervalId = setInterval(updateJointsBasedOnKeys, KEY_UPDATE_INTERVAL_MS);
    }

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [pressedKeys, compoundMovements, keyboardEnabled]); // Dependencies: re-run when pressedKeys, compoundMovements, or keyboardEnabled change

  // Mouse handlers update the `pressedKeys` state, which triggers the interval effect
  const handleMouseDown = (key: string | undefined) => {
    if (key) {
      setPressedKeys((prevKeys) => new Set(prevKeys).add(key));
    }
  };

  const handleMouseUp = (key: string | undefined) => {
    if (key) {
      setPressedKeys((prevKeys) => {
        const newKeys = new Set(prevKeys);
        newKeys.delete(key);
        return newKeys;
      });
    }
  };

  // Component rendering uses the `joints` prop for display
  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Revolute Joints</h2>
        {onSpeedChange && (
          <div className="flex items-center space-x-2">
            <label className="text-sm font-medium text-gray-300">Speed:</label>
            <input
              type="range"
              min="0.1"
              max="5.0"
              step="0.1"
              value={speedMultiplier}
              onChange={(e) => onSpeedChange(parseFloat(e.target.value))}
              className="w-20 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
            />
            <span className="text-xs text-gray-400 min-w-[2rem]">{speedMultiplier.toFixed(1)}x</span>
          </div>
        )}
      </div>
      <table className="table-auto w-full text-left text-sm">
        <thead>
          <tr>
            <th className="text-left">Joint</th>
            <th className="text-left">Angle</th>
            <th className="text-left">Real Angle</th>
            <th className="text-left">Control</th>
          </tr>
        </thead>
        <tbody>
          {joints.map((detail) => {
            // Use `joints` prop for rendering current state
            const keyMapping = controlMode === 'gamepad' 
              ? gamepadControlMap[detail.servoId!] 
              : keyboardControlMap[detail.servoId!];
            const decreaseKey = keyMapping?.[1];
            const increaseKey = keyMapping?.[0];
            const isDecreaseActive =
              decreaseKey && pressedKeys.has(decreaseKey);
            const isIncreaseActive =
              increaseKey && pressedKeys.has(increaseKey);

            return (
              <tr key={detail.servoId}>
                <td className="">
                  {/* <span className="text-gray-600">{detail.servoId}</span>{" "} */}
                  {detail.name}
                </td>

                <td className="pr-2 text-center w-16">
                  {formatVirtualDegrees(detail.virtualDegrees)}
                </td>
                <td className="pl-2 text-center w-16">
                  {formatRealDegrees(detail.realDegrees)}
                </td>
                <td className="py-1 px-4 flex items-center">
                  <button
                    onMouseDown={() => handleMouseDown(decreaseKey)}
                    onMouseUp={() => handleMouseUp(decreaseKey)}
                    onMouseLeave={() => handleMouseUp(decreaseKey)} // Optional: stop if mouse leaves button while pressed
                    onTouchStart={() => handleMouseDown(decreaseKey)} // Optional: basic touch support
                    onTouchEnd={() => handleMouseUp(decreaseKey)} // Optional: basic touch support
                    className={`${
                      isDecreaseActive
                        ? "bg-blue-600"
                        : "bg-gray-700 hover:bg-gray-600"
                    } text-white text-xs font-bold w-5 h-5 text-right pr-1 uppercase select-none`} // Added select-none
                    style={{
                      clipPath:
                        "polygon(0 50%, 30% 0, 100% 0, 100% 100%, 30% 100%)",
                    }}
                  >
                    {decreaseKey || "-"}
                  </button>
                  <input
                    type="range"
                    min={Math.round(
                      radiansToDegrees(detail.limit?.lower ?? -Math.PI)
                    )}
                    max={Math.round(
                      radiansToDegrees(detail.limit?.upper ?? Math.PI)
                    )}
                    step="0.1"
                    value={detail.virtualDegrees || 0}
                    // Note: onChange is only triggered by user sliding the range input,
                    // not when the `value` prop changes programmatically (e.g., via button clicks).
                    onChange={(e) => {
                      const valueInDegrees = parseFloat(e.target.value);
                      updateJointDegrees(detail.servoId!, valueInDegrees);
                    }}
                    className="h-2 bg-gray-700 appearance-none cursor-pointer w-14 custom-range-thumb"
                  />
                  <button
                    onMouseDown={() => handleMouseDown(increaseKey)}
                    onMouseUp={() => handleMouseUp(increaseKey)}
                    onMouseLeave={() => handleMouseUp(increaseKey)} // Optional
                    onTouchStart={() => handleMouseDown(increaseKey)} // Optional
                    onTouchEnd={() => handleMouseUp(increaseKey)} // Optional
                    className={`${
                      isIncreaseActive
                        ? "bg-blue-600"
                        : "bg-gray-700 hover:bg-gray-600"
                    } text-white text-xs font-semibold w-5 h-5 text-left pl-1 uppercase select-none`} // Added select-none
                    style={{
                      clipPath:
                        "polygon(100% 50%, 70% 0, 0 0, 0 100%, 70% 100%)",
                    }}
                  >
                    {increaseKey || "+"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {/* Display compoundMovements if present */}
      {((controlMode === 'gamepad' && gamepadCompoundMovements.length > 0) || 
        (controlMode === 'keyboard' && compoundMovements && compoundMovements.length > 0)) && (
        <div className="mt-4">
          <div className="font-bold mb-2">Compound Movements</div>
          <table className="table-auto w-full text-left text-sm">
            <tbody>
              {(controlMode === 'gamepad' ? gamepadCompoundMovements : compoundMovements || []).map((cm, idx) => {
                const decreaseKey = cm.keys[1];
                const increaseKey = cm.keys[0];
                const isDecreaseActive =
                  decreaseKey && pressedKeys.has(decreaseKey);
                const isIncreaseActive =
                  increaseKey && pressedKeys.has(increaseKey);
                return (
                  <tr key={idx}>
                    <td className="font-semibold pr-2 align-top">{cm.name}</td>
                    <td>
                      {cm.keys && cm.keys.length > 0 && (
                        <span className="space-x-1 flex flex-row">
                          {/* Decrease key */}
                          <button
                            onMouseDown={() => handleMouseDown(decreaseKey)}
                            onMouseUp={() => handleMouseUp(decreaseKey)}
                            onMouseLeave={() => handleMouseUp(decreaseKey)}
                            onTouchStart={() => handleMouseDown(decreaseKey)}
                            onTouchEnd={() => handleMouseUp(decreaseKey)}
                            className={`${
                              isDecreaseActive
                                ? "bg-blue-600"
                                : "bg-gray-700 hover:bg-gray-600"
                            } text-white text-xs font-bold w-5 h-5 text-right pr-1 uppercase select-none`}
                            style={{
                              clipPath:
                                "polygon(0 50%, 30% 0, 100% 0, 100% 100%, 30% 100%)",
                              minWidth: "1.8em",
                              minHeight: "1.8em",
                              fontWeight: 600,
                              boxShadow: "0 1px 2px 0 rgba(0,0,0,0.04)",
                            }}
                            tabIndex={-1}
                          >
                            {decreaseKey || "-"}
                          </button>
                          {/* Increase key */}
                          <button
                            onMouseDown={() => handleMouseDown(increaseKey)}
                            onMouseUp={() => handleMouseUp(increaseKey)}
                            onMouseLeave={() => handleMouseUp(increaseKey)}
                            onTouchStart={() => handleMouseDown(increaseKey)}
                            onTouchEnd={() => handleMouseUp(increaseKey)}
                            className={`${
                              isIncreaseActive
                                ? "bg-blue-600"
                                : "bg-gray-700 hover:bg-gray-600"
                            } text-white text-xs font-semibold w-5 h-5 text-left pl-1 uppercase select-none`}
                            style={{
                              clipPath:
                                "polygon(100% 50%, 70% 0, 0 0, 0 100%, 70% 100%)",
                              minWidth: "1.8em",
                              minHeight: "1.8em",
                              fontWeight: 600,
                              boxShadow: "0 1px 2px 0 rgba(0,0,0,0.04)",
                            }}
                            tabIndex={-1}
                          >
                            {increaseKey || "+"}
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <style jsx global>{`
        .custom-range-thumb::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #fff;
          cursor: pointer;
        }
        .custom-range-thumb::-moz-range-thumb {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #fff;
          cursor: pointer;
        }
        .custom-range-thumb::-ms-thumb {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #fff;
          cursor: pointer;
        }
        .custom-range-thumb {
          /* Remove default styles for Firefox */
          overflow: hidden;
        }
        input[type="range"].custom-range-thumb {
          /* Remove default focus outline for Chrome */
          outline: none;
        }
        .slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: #3b82f6;
          cursor: pointer;
        }
        .slider::-moz-range-thumb {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: #3b82f6;
          cursor: pointer;
          border: none;
        }
      `}</style>
    </div>
  );
}
