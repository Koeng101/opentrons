// health check tests
import {actions as robotActions} from '../../robot'
import {__mockThunk, fetchHealth} from '../health'
import {
  reducer,
  startHealthCheck,
  stopHealthCheck,
  setHealthCheckId,
  clearHealthCheckId,
  resetHealthCheck,
  healthCheckMiddleware,
  makeGetHealthCheckOk
} from '..'

jest.mock('../health')

const name = 'opentrons-dev'
const robot = {name, ip: '1.2.3.4', port: '1234'}

describe('health check', () => {
  let state

  beforeEach(() => {
    state = {
      robot: {
        connection: {
          connectedTo: name,
          connectRequest: {name},
          discoveredByName: {[name]: robot}}
      },
      api: {
        healthCheck: {
          alreadyRunning: {id: 1, missed: 0},
          alreadyMissed: {id: 2, missed: 2},
          [name]: {id: null, missed: 1}
        }
      }
    }
  })

  describe('actions', () => {
    test('START_HEALTH_CHECK', () => {
      expect(startHealthCheck(robot)).toEqual({
        type: 'api:START_HEALTH_CHECK',
        payload: {robot}
      })
    })

    test('STOP_HEALTH_CHECK', () => {
      expect(stopHealthCheck(robot)).toEqual({
        type: 'api:STOP_HEALTH_CHECK',
        payload: {robot}
      })
    })

    test('SET_HEALTH_CHECK_ID', () => {
      expect(setHealthCheckId(robot, 1234)).toEqual({
        type: 'api:SET_HEALTH_CHECK_ID',
        payload: {robot, id: 1234}
      })
    })

    test('CLEAR_HEALTH_CHECK_ID', () => {
      expect(clearHealthCheckId(robot)).toEqual({
        type: 'api:CLEAR_HEALTH_CHECK_ID',
        payload: {robot}
      })
    })

    test('RESET_HEALTH_CHECK', () => {
      expect(resetHealthCheck(robot)).toEqual({
        type: 'api:RESET_HEALTH_CHECK',
        payload: {robot}
      })
    })
  })

  describe('middleware', () => {
    let store
    let next
    let invoke

    beforeEach(() => {
      store = {getState: jest.fn(() => state), dispatch: jest.fn()}
      next = jest.fn()
      invoke = (action) => healthCheckMiddleware(store)(next)(action)
    })

    afterEach(() => {
      jest.clearAllTimers()
      jest.useRealTimers()
    })

    test('returns next(action)', () => {
      const connectResponse = robotActions.connectResponse()
      const expected = {foo: 'bar'}

      next.mockReturnValueOnce(expected)

      const result = invoke(connectResponse)
      expect(next).toHaveBeenCalledWith(connectResponse)
      expect(result).toBe(expected)
    })

    test('START_HEALTH_CHECK starts an interval and saves it', () => {
      const id = 1234
      jest.useFakeTimers()
      setInterval.mockReturnValueOnce(id)
      invoke(startHealthCheck(robot))

      expect(setInterval).toHaveBeenCalledWith(expect.any(Function), 3000)
      expect(store.dispatch).toHaveBeenCalledWith(setHealthCheckId(robot, id))
    })

    test('START_HEALTH_CHECK dispatches fetchHealth on interval', () => {
      jest.useFakeTimers()
      invoke(startHealthCheck(robot))

      const intervalFn = setInterval.mock.calls[0][0]
      expect(store.dispatch).not.toHaveBeenCalledWith(__mockThunk)
      intervalFn()
      expect(fetchHealth).toHaveBeenCalledWith(robot)
      expect(store.dispatch).toHaveBeenCalledWith(__mockThunk)
    })

    test('STOP_HEALTH_CHECK clears interval and saves it', () => {
      const robot = {name: 'alreadyRunning'}
      jest.useFakeTimers()
      invoke(stopHealthCheck(robot))

      expect(clearInterval).toHaveBeenCalledWith(1)
      expect(store.dispatch).toHaveBeenCalledWith(clearHealthCheckId(robot))
    })

    test('START_HEALTH_CHECK noops if health check is already running', () => {
      jest.useFakeTimers()
      invoke(startHealthCheck({name: 'alreadyRunning'}))
      expect(setInterval).toHaveBeenCalledTimes(0)
      expect(store.dispatch).toHaveBeenCalledTimes(0)
    })

    test('STOP_HEALTH_CHECK noops if health check is not running', () => {
      jest.useFakeTimers()
      invoke(stopHealthCheck({name}))
      expect(setInterval).toHaveBeenCalledTimes(0)
      expect(store.dispatch).toHaveBeenCalledTimes(0)
    })

    test('CONNECT_RESPONSE success dispatches START_HEALTH_CHECK', () => {
      state.robot.connection.connectedTo = ''
      invoke(robotActions.connectResponse())
      // middleware should pull `robot` from the connection request state
      expect(store.dispatch).toHaveBeenCalledWith(startHealthCheck(robot))
    })

    test('CONNECT_RESPONSE failure noops', () => {
      invoke(robotActions.connectResponse(new Error('AH')))
      expect(store.dispatch).toHaveBeenCalledTimes(0)
    })

    test('DISCONNECT_RESPONSE dispatches (STOP|RESET)_HEALTH_CHECK', () => {
      const expectedRobot = expect.objectContaining({name})
      invoke(robotActions.disconnectResponse())
      // middleware should pull `robot` from the connection state
      expect(store.dispatch)
        .toHaveBeenCalledWith(stopHealthCheck(expectedRobot))
      expect(store.dispatch)
        .toHaveBeenCalledWith(resetHealthCheck(expectedRobot))
    })

    test('HEALTH_FAILURE sends STOP_HEALTH_CHECK if over threshold', () => {
      const robot = {name: 'alreadyMissed'}
      invoke({type: 'api:HEALTH_FAILURE', payload: {robot}})
      expect(store.dispatch).toHaveBeenCalledWith(stopHealthCheck(robot))
    })

    test('HEALTH_FAILURE noops if under threshold', () => {
      const robot = {name: 'alreadyRunning'}
      invoke({type: 'api:HEALTH_FAILURE', payload: {robot}})
      expect(store.dispatch).not.toHaveBeenCalledWith(stopHealthCheck(robot))
    })

    test('HEALTH_FAILURE noops if not running', () => {
      state.api.healthCheck[name].missed = 2
      invoke({type: 'api:HEALTH_FAILURE', payload: {robot}})
      expect(store.dispatch).not.toHaveBeenCalledWith(stopHealthCheck(robot))
    })
  })

  describe('reducer', () => {
    const reduce = (action) => reducer(state.api, action).healthCheck

    test('RESET_HEALTH_CHECK resets interval ID and count', () => {
      const action = resetHealthCheck({name: 'alreadyMissed'})
      expect(reduce(action)).toEqual({
        alreadyRunning: {id: 1, missed: 0},
        alreadyMissed: {id: null, missed: 0},
        [name]: {id: null, missed: 1}
      })
    })

    test('SET_HEALTH_CHECK_ID sets interval ID and resets count', () => {
      const action = setHealthCheckId(robot, 1234)
      expect(reduce(action)).toEqual({
        alreadyRunning: {id: 1, missed: 0},
        alreadyMissed: {id: 2, missed: 2},
        [name]: {id: 1234, missed: 0}
      })
    })

    test('CLEAR_HEALTH_CHECK_ID clears interval ID', () => {
      const action = clearHealthCheckId({name: 'alreadyRunning'})
      expect(reduce(action)).toEqual({
        alreadyRunning: {id: null, missed: 0},
        alreadyMissed: {id: 2, missed: 2},
        [name]: {id: null, missed: 1}
      })
    })

    test('HEALTH_SUCCESS resets missed to 0', () => {
      const robot = {name: 'alreadyMissed'}
      const action = {type: 'api:HEALTH_SUCCESS', payload: {robot}}
      expect(reduce(action)).toEqual({
        alreadyRunning: {id: 1, missed: 0},
        alreadyMissed: {id: 2, missed: 0},
        [name]: {id: null, missed: 1}
      })
    })

    test('HEALTH_SUCCESS noops if not running', () => {
      const action = {type: 'api:HEALTH_SUCCESS', payload: {robot}}
      expect(reduce(action)).toEqual({
        alreadyRunning: {id: 1, missed: 0},
        alreadyMissed: {id: 2, missed: 2},
        [name]: {id: null, missed: 1}
      })
    })

    test('HEALTH_FAILURE increases missed by 1', () => {
      const robot = {name: 'alreadyRunning'}
      const action = {type: 'api:HEALTH_FAILURE', payload: {robot}}
      expect(reduce(action)).toEqual({
        alreadyRunning: {id: 1, missed: 1},
        alreadyMissed: {id: 2, missed: 2},
        [name]: {id: null, missed: 1}
      })
    })

    test('HEALTH_FAILURE noops if not running', () => {
      const action = {type: 'api:HEALTH_FAILURE', payload: {robot}}
      expect(reduce(action)).toEqual({
        alreadyRunning: {id: 1, missed: 0},
        alreadyMissed: {id: 2, missed: 2},
        [name]: {id: null, missed: 1}
      })
    })
  })

  describe('selectors', () => {
    test('makeGetHealthCheckOk', () => {
      const getHealthCheckOk = makeGetHealthCheckOk()

      expect(getHealthCheckOk(state, robot)).toEqual(true)
      expect(getHealthCheckOk(state, {name: 'alreadyRunning'})).toEqual(true)
      expect(getHealthCheckOk(state, {name: 'alreadyMissed'})).toEqual(false)
      expect(getHealthCheckOk(state, {name: 'foobar'})).toEqual(null)
    })
  })
})
