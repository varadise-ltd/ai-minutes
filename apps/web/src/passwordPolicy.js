export const passwordHint = 'Use 8–200 characters, including an uppercase letter, a lowercase letter and a number.';
export const newPasswordProps = {
  minLength: 8,
  maxLength: 200,
  pattern: '(?=.*[A-Z])(?=.*[a-z])(?=.*[0-9]).{8,200}',
  title: passwordHint,
  autoComplete: 'new-password'
};
