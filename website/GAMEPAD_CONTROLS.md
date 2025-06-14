# PS5 DualSense Gamepad Control for SO-ARM100

This document describes the implementation and usage of PS5 DualSense gamepad control for the SO-ARM100 robotic arm.

## Features

- **Dual Control Modes**: Switch between keyboard and gamepad control
- **Connection Detection**: Automatic detection of PS5 DualSense controller
- **Connection Type Indication**: Shows whether the controller is connected via USB or Bluetooth
- **Real-time Control**: Smooth analog stick control for continuous movements
- **Button Mapping**: Discrete button controls for specific actions

## Gamepad Controls

### Analog Sticks
- **Left Stick X-axis**: Base rotation (Servo 1)
- **Left Stick Y-axis**: Pitch movement (Servo 2)
- **Right Stick X-axis**: Elbow movement (Servo 3)
- **Right Stick Y-axis**: Wrist pitch (Servo 4)

### Buttons
- **L1**: Wrist roll left (Servo 5)
- **R1**: Wrist roll right (Servo 5)
- **L2**: Close jaw (Servo 6)
- **R2**: Open jaw (Servo 6)

## Connection Status Indicators

- **Red**: Not connected
- **Green**: Connected via USB
- **Blue**: Connected via Bluetooth

## Usage Instructions

1. **Connect your PS5 DualSense controller**:
   - **USB**: Connect via USB-C cable
   - **Bluetooth**: Pair with your computer

2. **Navigate to the play page**: Go to `/play/so-arm100`

3. **Select control mode**:
   - Click "Keyboard" for traditional keyboard controls
   - Click "Gamepad" for PS5 DualSense control (only available when controller is connected)

4. **Control the robot**:
   - Use analog sticks for smooth, continuous movements
   - Use trigger buttons (L2/R2) for jaw control
   - Use shoulder buttons (L1/R1) for wrist rotation

## Technical Implementation

### Components

- **GamepadControl.tsx**: Main gamepad control component
- **ControlPanel/index.tsx**: Updated to include gamepad control integration
- **RevoluteJointsTable.tsx**: Modified to respect control mode selection

### Key Features

1. **Gamepad API Integration**: Uses the Web Gamepad API for controller detection and input
2. **Connection Type Detection**: Differentiates between USB and Bluetooth connections
3. **Deadzone Handling**: Implements deadzone for analog sticks to prevent drift
4. **Control Mode Switching**: Seamless switching between keyboard and gamepad modes
5. **Real-time Updates**: 60fps polling for smooth control response

### Configuration

```typescript
const GAMEPAD_UPDATE_INTERVAL = 16; // ~60fps
const GAMEPAD_DEADZONE = 0.1;
const GAMEPAD_SENSITIVITY = 0.3;
```

## Browser Compatibility

- **Chrome/Chromium**: Full support
- **Firefox**: Full support
- **Safari**: Limited support (may require user interaction)
- **Edge**: Full support

## Troubleshooting

### Controller Not Detected
1. Ensure the controller is properly connected
2. Try pressing any button on the controller
3. Check browser console for errors
4. Refresh the page

### Poor Responsiveness
1. Check USB connection (USB typically has better latency than Bluetooth)
2. Ensure no other applications are using the controller
3. Try adjusting sensitivity settings

### Bluetooth Connection Issues
1. Ensure controller is properly paired
2. Try disconnecting and reconnecting
3. USB connection is recommended for best performance

## Future Enhancements

- **Haptic Feedback**: Implement vibration feedback for better user experience
- **Custom Button Mapping**: Allow users to customize button assignments
- **Multiple Controller Support**: Support for multiple controllers
- **Advanced Gestures**: Implement complex movement patterns
- **Calibration**: Allow users to calibrate deadzone and sensitivity

## Development Notes

- The gamepad implementation is designed to work alongside existing keyboard controls
- Control mode switching is handled at the component level to prevent conflicts
- The system uses React hooks for state management and effect handling
- Gamepad polling is optimized to run at 60fps for smooth control