// 认证状态reducer
const initialState = {
    isAuthenticated: false,
    user_id: null,
    token: null,
    loading: false,
    error: null
};

const authReducer = (state = initialState, action) => {
    switch (action.type) {
        case 'AUTH_LOADING':
            return {
                ...state,
                loading: true,
                error: null
            };
        case 'AUTH_SUCCESS':
            return {
                ...state,
                isAuthenticated: true,
                user_id: action.payload.user_id,
                token: action.payload.token,
                loading: false,
                error: null
            };
        case 'AUTH_ERROR':
            return {
                ...state,
                isAuthenticated: false,
                user_id: null,
                token: null,
                loading: false,
                error: action.payload
            };
        case 'AUTH_LOGOUT':
            return {
                ...initialState
            };
        default:
            return state;
    }
};

export default authReducer;