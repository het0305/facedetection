import '@testing-library/jest-dom';
import { TextDecoder, TextEncoder } from 'util';

// react-router v7 needs these in the jsdom test environment.
Object.assign(global, { TextEncoder, TextDecoder });
